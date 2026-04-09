/**
 * /gsd-dream [--force] — manually trigger a consolidation pass. Runs the
 * same gate sequence as the automatic session_start trigger, but with
 * --force bypassing time+session gates (not the lock).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { DREAM_DEFAULTS, runDream } from "../memory/dream.js";

export function registerDreamCommand(pi: ExtensionAPI): void {
	pi.registerCommand("gsd-dream", {
		description:
			"Run the memory consolidation dream (add --force to bypass time/session gates)",
		handler: async (args, ctx) => {
			const root = ctx.cwd ?? process.cwd();
			const force = (args ?? "").trim().toLowerCase().includes("--force");
			const result = await runDream({
				projectRoot: root,
				force,
				bypassThrottle: force,
				config: DREAM_DEFAULTS,
			});

			if (!result.fired) {
				ctx.ui.notify(
					`dream skipped (${result.reason}): ${result.detail}`,
					"info",
				);
				return;
			}
			ctx.ui.notify(
				`dream prompt written to ${result.promptPath}. Send it to the agent; it will update files under ${result.memoryRoot}.`,
				"info",
			);
		},
	});
}
