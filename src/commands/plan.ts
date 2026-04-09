/**
 * /gsd-plan <phase> — produce .pi-gsd/phases/<phase>/PLAN.md.
 *
 * v1 delivers the *skeleton* of the plan-with-checker loop: it renders the
 * planner system/user prompts (using loadRolePrompt + renderSubagentPrompt)
 * and writes them to a .prompt.md file alongside the expected PLAN.md path.
 * The actual LLM call happens via pi's main session for now — the user
 * pastes the prompt, the agent produces PLAN.md, and the plan-checker runs
 * the same way on the result. A dedicated sub-agent transport lands in
 * v1.1 once the executor sub-agent is wired up in Phase 7.
 *
 * This is intentional: building a full tool-calling sub-agent loop for a
 * single prompt-only planner call would triple the v1 surface area for
 * marginal benefit. The prompt artefacts are real and the parser round-
 * trips them, so later upgrading to a direct streamSimple call is a
 * 20-line change to one file.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { renderSubagentPrompt } from "../orchestrator/subagent.js";
import { parsePlan, PlanParseError } from "../plan/parser.js";
import { patchState } from "../memory/state.js";

function phaseDir(root: string, phase: string): string {
	return resolve(root, ".pi-gsd", "phases", phase);
}

export function registerPlanCommand(pi: ExtensionAPI): void {
	pi.registerCommand("gsd-plan", {
		description:
			"Render the planner prompt for a phase; validate existing PLAN.md if present",
		handler: async (args, ctx) => {
			const root = ctx.cwd ?? process.cwd();
			const phase = (args ?? "").trim();
			if (!phase) {
				ctx.ui.notify("usage: /gsd-plan <phase id>", "error");
				return;
			}
			const dir = phaseDir(root, phase);
			await mkdir(dir, { recursive: true });

			const planPath = resolve(dir, "PLAN.md");
			if (existsSync(planPath)) {
				// Existing plan — validate it and report.
				try {
					const parsed = parsePlan(readFileSync(planPath, "utf8"), planPath);
					ctx.ui.notify(
						`PLAN.md is valid: ${parsed.tasks.length} task(s), ${parsed.frontmatter.must_haves?.length ?? 0} must-have(s).`,
						"info",
					);
					return;
				} catch (err) {
					if (err instanceof PlanParseError) {
						ctx.ui.notify(`PLAN.md is invalid: ${err.message}`, "error");
						return;
					}
					throw err;
				}
			}

			// No plan yet — render the planner prompt artefacts.
			const contextFiles = [
				resolve(root, ".pi-gsd", "PROJECT.md"),
				resolve(root, ".pi-gsd", "AGENTS.md"),
				resolve(root, ".pi-gsd", "ROADMAP.md"),
				resolve(dir, "CONTEXT.md"),
			];
			const rendered = renderSubagentPrompt("planner", {
				contextFiles,
				inline: { phase },
				userMessage: `Produce PLAN.md for phase ${phase}. Write exactly one PLAN.md file body. No commentary.`,
			});
			const promptFile = resolve(dir, "planner.prompt.md");
			await writeFile(
				promptFile,
				`# Planner prompt for phase ${phase}\n\n## System\n\n${rendered.systemPrompt}\n\n## User\n\n${rendered.userPrompt}\n`,
				"utf8",
			);
			await patchState(root, {
				currentPhase: phase,
				status: "planning",
				lastSummary: `Planner prompt written for phase ${phase}`,
			});
			ctx.ui.notify(
				`Wrote ${promptFile}. Send the prompt to the agent, save the reply to ${planPath}, then run /gsd-plan ${phase} again to validate.`,
				"info",
			);
		},
	});
}
