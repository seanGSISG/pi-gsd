/**
 * /gsd-status — print a dashboard of current state, latest phase, and
 * leaked worktrees.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { readState } from "../memory/state.js";
import { listWorktrees } from "../orchestrator/worktree.js";

export function registerStatusCommand(pi: ExtensionAPI): void {
	pi.registerCommand("gsd-status", {
		description: "Show pi-gsd project state and active worktrees",
		handler: async (_args, ctx) => {
			const root = ctx.cwd ?? process.cwd();
			const state = readState(root);
			const phasesDir = resolve(root, ".pi-gsd", "phases");
			const phases = existsSync(phasesDir)
				? readdirSync(phasesDir, { withFileTypes: true })
						.filter((e) => e.isDirectory())
						.map((e) => e.name)
						.sort()
				: [];

			let worktrees: Array<{ path: string; branch: string }> = [];
			try {
				worktrees = await listWorktrees(root);
			} catch {
				// not a git repo — leave empty
			}
			const gsdWorktrees = worktrees.filter((w) => w.branch.startsWith("pi-gsd/"));

			const lines = [
				`pi-gsd status (${root})`,
				`  phase:  ${state.currentPhase ?? "—"}`,
				`  plan:   ${state.currentPlan ?? "—"}`,
				`  status: ${state.status}`,
				`  last:   ${state.lastActivity}`,
				`  plans completed: ${state.plansCompleted}`,
				`  summary: ${state.lastSummary || "—"}`,
				"",
				`phases discovered: ${phases.length > 0 ? phases.join(", ") : "—"}`,
				`pi-gsd worktrees: ${
					gsdWorktrees.length > 0
						? gsdWorktrees.map((w) => `${w.branch} @ ${w.path}`).join(", ")
						: "none"
				}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
