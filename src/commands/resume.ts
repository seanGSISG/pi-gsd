/**
 * /gsd-resume — restart a paused execution from the most recent
 * .resume.json. v1 just reads the file and prints what would resume and
 * which worktrees still exist so the user can re-feed the executor
 * prompts. v1.1 will drive the restart directly.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { listWorktrees } from "../orchestrator/worktree.js";

interface ResumeState {
	phase: string;
	waves: Array<{ index: number; plans: string[] }>;
	started: string;
	results: Array<{ plan: string; wave: number; worktree: string; prompt: string }>;
}

function findLatestResume(root: string): ResumeState | null {
	const dir = resolve(root, ".pi-gsd", "phases");
	if (!existsSync(dir)) return null;
	const phases = readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort()
		.reverse();
	for (const p of phases) {
		const f = resolve(dir, p, ".resume.json");
		if (existsSync(f)) {
			return JSON.parse(readFileSync(f, "utf8")) as ResumeState;
		}
	}
	return null;
}

export function registerResumeCommand(pi: ExtensionAPI): void {
	pi.registerCommand("gsd-resume", {
		description: "Resume a paused pi-gsd execution from .resume.json",
		handler: async (_args, ctx) => {
			const root = ctx.cwd ?? process.cwd();
			const state = findLatestResume(root);
			if (!state) {
				ctx.ui.notify("no .resume.json found under any phase", "error");
				return;
			}
			let worktrees: Array<{ path: string; branch: string }> = [];
			try {
				worktrees = await listWorktrees(root);
			} catch {
				// ignore
			}
			const knownPaths = new Set(worktrees.map((w) => w.path));

			const lines = [
				`Resuming phase ${state.phase} (started ${state.started})`,
				`  ${state.waves.length} wave(s), ${state.results.length} plan(s)`,
				"",
			];
			for (const r of state.results) {
				const live = knownPaths.has(r.worktree) ? "live" : "MISSING";
				lines.push(`  wave ${r.wave} • ${r.plan} • worktree=${live} • prompt=${r.prompt}`);
			}
			lines.push(
				"",
				"Re-feed each executor prompt to the pi main session. Missing worktrees must be recreated with /gsd-execute.",
			);
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
