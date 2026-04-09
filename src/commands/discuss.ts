/**
 * /discuss <phase> — capture locked-in implementation decisions for a
 * phase into .pi-gsd/phases/<phase>/CONTEXT.md. In v1 this is a simple
 * three-question dialog; later phases will run a discuss sub-agent.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { patchState } from "../memory/state.js";

function phaseDir(root: string, phase: string): string {
	return resolve(root, ".pi-gsd", "phases", phase);
}

export function registerDiscussCommand(pi: ExtensionAPI): void {
	pi.registerCommand("gsd-discuss", {
		description:
			"Capture phase decisions into .pi-gsd/phases/<phase>/CONTEXT.md",
		handler: async (args, ctx) => {
			const root = ctx.cwd ?? process.cwd();
			const phase = (args ?? "").trim();
			if (!phase) {
				ctx.ui.notify("usage: /gsd-discuss <phase id, e.g. 01>", "error");
				return;
			}
			const dir = phaseDir(root, phase);
			await mkdir(dir, { recursive: true });

			const goal = await ctx.ui.input(
				`Phase ${phase}: what is the single goal?`,
				"",
			);
			if (!goal) {
				ctx.ui.notify("gsd-discuss cancelled", "info");
				return;
			}
			const constraints = await ctx.ui.input(
				"Any hard constraints? (comma-separated, blank to skip)",
				"",
			);
			const openQuestions = await ctx.ui.input(
				"Open questions you expect the planner to resolve?",
				"",
			);

			const body = `# Phase ${phase} — Context

## Goal

${goal}

## Hard constraints

${constraints ? constraints.split(",").map((c) => `- ${c.trim()}`).join("\n") : "_none_"}

## Open questions

${openQuestions || "_none_"}
`;
			const contextPath = resolve(dir, "CONTEXT.md");
			if (existsSync(contextPath)) {
				const ok = await ctx.ui.confirm(
					`Phase ${phase} CONTEXT.md exists`,
					"Overwrite?",
				);
				if (!ok) {
					ctx.ui.notify("gsd-discuss cancelled", "info");
					return;
				}
			}
			await writeFile(contextPath, body, "utf8");
			await patchState(root, {
				currentPhase: phase,
				status: "discussed",
				lastSummary: `Captured context for phase ${phase}`,
			});
			ctx.ui.notify(
				`Wrote ${contextPath}. Next: /gsd-plan ${phase}`,
				"info",
			);
		},
	});
}
