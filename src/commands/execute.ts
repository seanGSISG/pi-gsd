/**
 * /gsd-execute <phase> — run the wave scheduler over the phase's plans,
 * create isolated git worktrees for parallel-safe plans, and render one
 * executor prompt per plan. v1 stops at prompt-rendering + worktree setup
 * (deterministic, resumable). The actual LLM execution inside each
 * worktree is performed by the user via the main pi session in v1 and
 * replaced with an in-process Agent in v1.1.
 *
 * This phase is intentionally split from /gsd-plan so the orchestration
 * layer (scheduler + worktrees + resume state) can be tested end-to-end
 * without depending on an LLM round-trip.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parsePlan, PlanParseError } from "../plan/parser.js";
import type { Plan } from "../plan/schema.js";
import {
	schedulePlans,
	type PlanRef,
} from "../orchestrator/wave-scheduler.js";
import { renderSubagentPrompt } from "../orchestrator/subagent.js";
import { createWorktree } from "../orchestrator/worktree.js";
import { patchState } from "../memory/state.js";

function phaseDir(root: string, phase: string): string {
	return resolve(root, ".pi-gsd", "phases", phase);
}

/** Discover every PLAN.md inside a phase directory. */
function loadPhasePlans(dir: string): Plan[] {
	if (!existsSync(dir)) return [];
	const entries = readdirSync(dir, { withFileTypes: true });
	const plans: Plan[] = [];
	// Two layouts: single PLAN.md or NN-<slug>/PLAN.md subfolders.
	const direct = resolve(dir, "PLAN.md");
	if (existsSync(direct)) {
		plans.push(parsePlan(readFileSync(direct, "utf8"), direct));
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const planFile = resolve(dir, entry.name, "PLAN.md");
		if (existsSync(planFile)) {
			plans.push(parsePlan(readFileSync(planFile, "utf8"), planFile));
		}
	}
	return plans;
}

export function registerExecuteCommand(pi: ExtensionAPI): void {
	pi.registerCommand("gsd-execute", {
		description:
			"Schedule plans into waves, create worktrees, render executor prompts",
		handler: async (args, ctx) => {
			const root = ctx.cwd ?? process.cwd();
			const phase = (args ?? "").trim();
			if (!phase) {
				ctx.ui.notify("usage: /gsd-execute <phase id>", "error");
				return;
			}
			const dir = phaseDir(root, phase);

			let plans: Plan[];
			try {
				plans = loadPhasePlans(dir);
			} catch (err) {
				if (err instanceof PlanParseError) {
					ctx.ui.notify(`invalid PLAN.md: ${err.message}`, "error");
					return;
				}
				throw err;
			}
			if (plans.length === 0) {
				ctx.ui.notify(
					`no PLAN.md found under ${dir} — run /gsd-plan ${phase} first`,
					"error",
				);
				return;
			}

			const refs: PlanRef[] = plans.map((p) => ({
				plan: p.frontmatter.plan,
				depends_on: p.frontmatter.depends_on,
				files_modified: p.frontmatter.files_modified,
			}));

			let schedule;
			try {
				schedule = schedulePlans(refs);
			} catch (err) {
				ctx.ui.notify(`schedule error: ${(err as Error).message}`, "error");
				return;
			}

			const hardConflicts = schedule.waves.flatMap((w) => w.conflicts);
			if (hardConflicts.length > 0) {
				const listing = hardConflicts
					.map((c) => `  ${c.a} ↔ ${c.b}: ${c.files.join(", ")}`)
					.join("\n");
				const proceed = await ctx.ui.confirm(
					"Wave scheduler found file conflicts",
					`Two plans in the same wave touch the same files:\n${listing}\n\nForcing sequential execution?`,
				);
				if (!proceed) {
					ctx.ui.notify(
						"execute cancelled — split conflicting plans or edit files_modified",
						"info",
					);
					return;
				}
			}

			// Create one worktree per plan and render its executor prompt.
			const results: Array<{ plan: string; wave: number; worktree: string; prompt: string }> = [];
			for (const wave of schedule.waves) {
				for (const planId of wave.plans) {
					const plan = plans.find((p) => p.frontmatter.plan === planId)!;
					const branch = `pi-gsd/${phase}-${planId.replace(/\//g, "-")}`;
					const worktreePath = resolve(
						root,
						".pi-gsd",
						"worktrees",
						`${phase}-${planId.replace(/\//g, "-")}`,
					);
					let wtPath = worktreePath;
					try {
						const handle = await createWorktree(root, worktreePath, branch);
						wtPath = handle.path;
					} catch (err) {
						ctx.ui.notify(
							`worktree creation failed for ${planId}: ${(err as Error).message}`,
							"warning",
						);
					}

					const planBody = JSON.stringify(plan, null, 2);
					const rendered = renderSubagentPrompt("executor", {
						contextFiles: [
							resolve(root, ".pi-gsd", "PROJECT.md"),
							resolve(root, ".pi-gsd", "AGENTS.md"),
						],
						inline: {
							phase,
							plan: planId,
							wave: String(wave.index),
							worktree: wtPath,
							plan_body: planBody,
						},
						userMessage: `Execute all tasks in plan ${planId} inside the worktree at ${wtPath}. Commit atomically per task, then write SUMMARY.md at ${resolve(dir, `${planId}-SUMMARY.md`)}.`,
					});
					const promptPath = resolve(dir, `${planId}.executor.prompt.md`);
					await mkdir(dir, { recursive: true });
					await writeFile(
						promptPath,
						`# Executor prompt for ${planId} (wave ${wave.index})\n\n## System\n\n${rendered.systemPrompt}\n\n## User\n\n${rendered.userPrompt}\n`,
						"utf8",
					);
					results.push({
						plan: planId,
						wave: wave.index,
						worktree: wtPath,
						prompt: promptPath,
					});
				}
			}

			// Persist resume state so a crashed session can pick up.
			const resume = {
				phase,
				waves: schedule.waves.map((w) => ({
					index: w.index,
					plans: w.plans,
				})),
				started: new Date().toISOString(),
				results,
			};
			await writeFile(
				resolve(dir, ".resume.json"),
				`${JSON.stringify(resume, null, 2)}\n`,
				"utf8",
			);
			await patchState(root, {
				currentPhase: phase,
				status: "executing",
				lastSummary: `Scheduled ${plans.length} plan(s) into ${schedule.waves.length} wave(s)`,
			});

			const lines = [
				`Phase ${phase}: ${plans.length} plan(s) in ${schedule.waves.length} wave(s).`,
				...results.map(
					(r) =>
						`  wave ${r.wave} • ${r.plan} • worktree=${r.worktree} • prompt=${r.prompt}`,
				),
				"",
				"Next: feed each prompt to the pi main session, execute in its worktree, then /gsd-verify when done.",
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
