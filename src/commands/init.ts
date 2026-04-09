/**
 * /gsd-init — scaffold .pi-gsd/ for the current project.
 *
 * Creates PROJECT.md, AGENTS.md, ROADMAP.md, STATE.md from user-provided
 * answers. Does not spawn a sub-agent in v1 — the planner sub-agent comes
 * online with /plan. v1 /gsd-init just asks three questions and writes the
 * files so later phases have something to load.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ensureAgentsMd } from "../memory/agents-md.js";
import { writeState } from "../memory/state.js";

export function registerInitCommand(pi: ExtensionAPI): void {
	pi.registerCommand("gsd-init", {
		description: "Scaffold .pi-gsd/ with PROJECT.md, AGENTS.md, ROADMAP.md",
		handler: async (_args, ctx) => {
			const root = ctx.cwd ?? process.cwd();
			const dir = resolve(root, ".pi-gsd");
			if (existsSync(resolve(dir, "PROJECT.md"))) {
				const overwrite = await ctx.ui.confirm(
					"pi-gsd is already initialized",
					"PROJECT.md exists. Overwrite anyway?",
				);
				if (!overwrite) {
					ctx.ui.notify("gsd-init cancelled", "info");
					return;
				}
			}

			const name = await ctx.ui.input("Project name?", "my-project");
			if (!name) {
				ctx.ui.notify("gsd-init cancelled", "info");
				return;
			}
			const vision = await ctx.ui.input(
				"One-sentence vision?",
				"Ship something small and solid.",
			);
			const stack = await ctx.ui.input(
				"Primary stack (language / framework)?",
				"TypeScript",
			);

			await mkdir(dir, { recursive: true });
			await writeFile(
				resolve(dir, "PROJECT.md"),
				`# ${name}\n\n## Vision\n\n${vision ?? ""}\n\n## Stack\n\n${stack ?? ""}\n`,
				"utf8",
			);
			await writeFile(
				resolve(dir, "ROADMAP.md"),
				`# Roadmap: ${name}\n\nAdd phases below as you plan them. Each entry is\n\`- [ ] NN-<slug> — <one-line goal> — success: <observable>\`\n`,
				"utf8",
			);
			await ensureAgentsMd(root, { projectName: name, summary: vision ?? "" });
			await writeState(root, {
				currentPhase: null,
				currentPlan: null,
				status: "initialized",
				lastActivity: new Date().toISOString(),
				plansCompleted: 0,
				lastSummary: `Initialized pi-gsd for ${name}`,
			});

			ctx.ui.notify(
				`pi-gsd initialized at ${dir}. Next: edit ROADMAP.md, then /discuss <phase>.`,
				"info",
			);
		},
	});
}
