/**
 * /gsd-ship — assemble a PR description from the most recent phase's
 * SUMMARY.md + VERIFICATION.md and optionally run `gh pr create`.
 * v1 writes the PR body to .pi-gsd/last-pr.md; actually invoking gh is
 * gated behind a user confirmation and requires the gh CLI on PATH.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { readState, patchState } from "../memory/state.js";

const pExecFile = promisify(execFile);

function latestPhase(root: string): string | null {
	const dir = resolve(root, ".pi-gsd", "phases");
	if (!existsSync(dir)) return null;
	const entries = readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();
	return entries.at(-1) ?? null;
}

export function registerShipCommand(pi: ExtensionAPI): void {
	pi.registerCommand("gsd-ship", {
		description:
			"Assemble PR body from latest phase SUMMARY/VERIFICATION and optionally gh pr create",
		handler: async (_args, ctx) => {
			const root = ctx.cwd ?? process.cwd();
			const state = readState(root);
			const phase = state.currentPhase ?? latestPhase(root);
			if (!phase) {
				ctx.ui.notify("no phase found to ship", "error");
				return;
			}
			const dir = resolve(root, ".pi-gsd", "phases", phase);
			if (!existsSync(dir)) {
				ctx.ui.notify(`phase directory missing: ${dir}`, "error");
				return;
			}

			const summaries = readdirSync(dir)
				.filter((f) => f.endsWith("-SUMMARY.md") || f === "SUMMARY.md")
				.map((f) => readFileSync(resolve(dir, f), "utf8"));
			const verification = existsSync(resolve(dir, "VERIFICATION.md"))
				? readFileSync(resolve(dir, "VERIFICATION.md"), "utf8")
				: "_(no VERIFICATION.md — run /gsd-verify first)_";

			const title = `phase ${phase}`;
			const body = `# ${title}\n\n## Summary\n\n${
				summaries.length > 0 ? summaries.join("\n\n---\n\n") : "_(no SUMMARY.md)_"
			}\n\n## Verification\n\n${verification}\n`;

			await mkdir(resolve(root, ".pi-gsd"), { recursive: true });
			const prPath = resolve(root, ".pi-gsd", "last-pr.md");
			await writeFile(prPath, body, "utf8");

			const runGh = await ctx.ui.confirm(
				"Create PR via gh?",
				`Wrote ${prPath}. Run 'gh pr create' now?`,
			);
			if (runGh) {
				try {
					await pExecFile("gh", ["pr", "create", "--title", title, "--body-file", prPath], {
						cwd: root,
					});
					ctx.ui.notify("gh pr create succeeded", "info");
				} catch (err) {
					ctx.ui.notify(`gh pr create failed: ${(err as Error).message}`, "error");
				}
			}
			await patchState(root, {
				status: "shipped",
				lastSummary: `Shipped phase ${phase}`,
			});
		},
	});
}
