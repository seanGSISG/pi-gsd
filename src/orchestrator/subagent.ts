/**
 * Sub-agent wrapper. v1 uses a low-level single-call approach against
 * @mariozechner/pi-ai's streamSimple with tool calling disabled — sub-agents
 * here are "analyst" agents (planner, plan-checker, verifier, judges) that
 * consume context and emit structured markdown/JSON, not execute tools.
 *
 * The executor sub-agent (Phase 7) will upgrade to a full Agent instance
 * from @mariozechner/pi-agent-core with file tools attached. For now that
 * is out of scope and /execute runs inline inside the main pi session.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

export interface SubagentPromptContext {
	/** Files to inject (paths will be read and each file contents inlined). */
	contextFiles: string[];
	/** Inline extra context (e.g. parsed state, numbers). */
	inline: Record<string, string>;
	/** User intent / task for this sub-agent run. */
	userMessage: string;
}

export interface SubagentRunResult {
	systemPrompt: string;
	userPrompt: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = resolve(HERE, "..", "..", "agents");

/**
 * Load a role prompt from /agents/<role>.md. Returns the raw markdown so
 * callers can decide how to deliver it (as a system prompt to streamSimple,
 * or wrapped into a user-visible message when running inline).
 */
export function loadRolePrompt(role: string): string {
	const path = resolve(AGENTS_DIR, `${role}.md`);
	if (!existsSync(path)) {
		throw new Error(`missing role prompt: ${path}`);
	}
	return readFileSync(path, "utf8");
}

/**
 * Render the final system+user prompt pair for a sub-agent. Pure function —
 * no LLM calls. Callers choose the transport (streamSimple, inline pi
 * session, or queued message).
 */
export function renderSubagentPrompt(
	role: string,
	context: SubagentPromptContext,
): SubagentRunResult {
	const rolePrompt = loadRolePrompt(role);

	const fileBlocks = context.contextFiles
		.filter((p) => existsSync(p))
		.map((p) => `<file path="${p}">\n${readFileSync(p, "utf8")}\n</file>`)
		.join("\n\n");

	const inlineBlocks = Object.entries(context.inline)
		.map(([k, v]) => `<${k}>\n${v}\n</${k}>`)
		.join("\n\n");

	return {
		systemPrompt: rolePrompt,
		userPrompt: [fileBlocks, inlineBlocks, context.userMessage]
			.filter((s) => s.length > 0)
			.join("\n\n"),
	};
}
