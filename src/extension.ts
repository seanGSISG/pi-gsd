/**
 * pi-gsd — modern agentic workflow engine for the pi coding CLI.
 *
 * Extension entry point. Registers all pi-gsd slash commands, the
 * deterministic pre-tool safety hooks, and the session_shutdown hook
 * that drips SessionMemory captures into the daily log stream.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerHelloCommand } from "./commands/hello.js";
import { registerInitCommand } from "./commands/init.js";
import { registerDiscussCommand } from "./commands/discuss.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerExecuteCommand } from "./commands/execute.js";
import { registerVerifyCommand } from "./commands/verify.js";
import { registerShipCommand } from "./commands/ship.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerResumeCommand } from "./commands/resume.js";
import { registerDreamCommand } from "./commands/dream.js";
import { registerMemoryCommand } from "./commands/memory.js";
import { registerHooks } from "./hooks/index.js";
import { appendSessionMemory } from "./memory/session-memory.js";
import { readState } from "./memory/state.js";

export default function piGsd(pi: ExtensionAPI): void {
	const root = process.cwd();

	registerHelloCommand(pi);
	registerInitCommand(pi);
	registerDiscussCommand(pi);
	registerPlanCommand(pi);
	registerExecuteCommand(pi);
	registerVerifyCommand(pi);
	registerShipCommand(pi);
	registerStatusCommand(pi);
	registerResumeCommand(pi);
	registerDreamCommand(pi);
	registerMemoryCommand(pi);
	registerHooks(pi, root);

	// Tier 1 memory: on session shutdown, append a brief marker to the
	// daily log stream. This is intentionally minimal — the dream loop
	// does the heavy lifting. We capture the current STATE.md snapshot
	// so the dream can correlate log entries with phase positions.
	pi.on("session_shutdown", async () => {
		try {
			const state = readState(root);
			if (state.currentPhase || state.lastSummary) {
				await appendSessionMemory(root, {
					source: "session_shutdown",
					body: [
						`phase: ${state.currentPhase ?? "—"}`,
						`plan: ${state.currentPlan ?? "—"}`,
						`status: ${state.status}`,
						`summary: ${state.lastSummary || "—"}`,
					].join("\n"),
				});
			}
		} catch {
			// session_shutdown must never throw — best-effort only
		}
	});
}
