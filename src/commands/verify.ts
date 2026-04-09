/**
 * /gsd-verify <phase> — run the 3-layer verification for a phase.
 *
 * Layer 1 (deterministic) always runs and is recorded to VERIFICATION.md.
 * Layers 2 and 3 (LLM self-check, ensemble judges) are represented by
 * rendered prompt artefacts written to phases/<phase>/verifier.prompt.md
 * and judges/<kind>.prompt.md; v1 relies on the main pi session to run
 * them, v1.1 upgrades to in-process sub-agents.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parsePlan } from "../plan/parser.js";
import type { Plan } from "../plan/schema.js";
import {
	runDeterministicChecks,
	formatReportMarkdown,
} from "../verification/deterministic.js";
import { renderSubagentPrompt } from "../orchestrator/subagent.js";
import { patchState } from "../memory/state.js";

function phaseDir(root: string, phase: string): string {
	return resolve(root, ".pi-gsd", "phases", phase);
}

function loadPhasePlans(dir: string): Plan[] {
	if (!existsSync(dir)) return [];
	const plans: Plan[] = [];
	const direct = resolve(dir, "PLAN.md");
	if (existsSync(direct)) {
		plans.push(parsePlan(readFileSync(direct, "utf8"), direct));
	}
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const p = resolve(dir, entry.name, "PLAN.md");
		if (existsSync(p)) plans.push(parsePlan(readFileSync(p, "utf8"), p));
	}
	return plans;
}

export function registerVerifyCommand(pi: ExtensionAPI): void {
	pi.registerCommand("gsd-verify", {
		description:
			"Run deterministic checks + render verifier prompt → VERIFICATION.md",
		handler: async (args, ctx) => {
			const root = ctx.cwd ?? process.cwd();
			const phase = (args ?? "").trim();
			if (!phase) {
				ctx.ui.notify("usage: /gsd-verify <phase id>", "error");
				return;
			}
			const dir = phaseDir(root, phase);
			const plans = loadPhasePlans(dir);
			if (plans.length === 0) {
				ctx.ui.notify(
					`no PLAN.md under ${dir} — run /gsd-plan ${phase} first`,
					"error",
				);
				return;
			}

			ctx.ui.notify("running deterministic checks…", "info");
			const report = await runDeterministicChecks(root);

			// Assemble the initial VERIFICATION.md skeleton. The LLM layer will
			// append the must-have verdicts later; for v1 we leave those as
			// empty checkboxes for the user to confirm.
			const mustHaves = plans.flatMap((p) => p.frontmatter.must_haves ?? []);
			const mhLines = mustHaves.map(
				(m) => `- [ ] ${m.id} (${m.kind}): ${m.statement}`,
			);
			const verificationPath = resolve(dir, "VERIFICATION.md");
			const body = [
				`# Phase ${phase} — Verification\n`,
				"## Must-haves\n",
				mhLines.length > 0 ? mhLines.join("\n") : "_no must-haves declared_",
				"",
				formatReportMarkdown(report),
				`## Verdict\n\n${
					report.overall === "fail" ? "FAIL" : report.overall === "pass" ? "PARTIAL" : "PARTIAL"
				}  — deterministic checks ${report.overall.toUpperCase()}; must-haves require LLM verification.\n`,
			].join("\n");
			await mkdir(dir, { recursive: true });
			await writeFile(verificationPath, body, "utf8");

			// Render the LLM verifier prompt for the user/agent to run.
			const rendered = renderSubagentPrompt("verifier", {
				contextFiles: [
					...plans.map((p) => resolve(dir, `${p.frontmatter.plan}-SUMMARY.md`)),
					verificationPath,
				],
				inline: {
					phase,
					deterministic_report: formatReportMarkdown(report),
					plans_json: JSON.stringify(plans, null, 2),
				},
				userMessage: `Verify every must-have for phase ${phase}. Update ${verificationPath} in place.`,
			});
			const promptPath = resolve(dir, "verifier.prompt.md");
			await writeFile(
				promptPath,
				`# Verifier prompt for phase ${phase}\n\n## System\n\n${rendered.systemPrompt}\n\n## User\n\n${rendered.userPrompt}\n`,
				"utf8",
			);

			await patchState(root, {
				currentPhase: phase,
				status: report.overall === "pass" ? "verified-det" : "verifying",
				lastSummary: `Deterministic checks: ${report.overall}`,
			});

			ctx.ui.notify(
				`Deterministic: ${report.overall.toUpperCase()}. Wrote ${verificationPath} and ${promptPath}.`,
				"info",
			);
		},
	});
}
