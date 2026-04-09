/**
 * Hook registration. Wires the deterministic guards into pi's extension
 * event bus via `pi.on("tool_call", ...)` — the blocking event in pi's
 * extension API. ToolCallEventResult.block=true with a reason aborts the
 * pending tool invocation before it executes.
 *
 * pi's tool_call event is discriminated on `toolName`, but when the union
 * is narrowed via the `=== "write"` literal check the input type still
 * shows up as unknown in our tsconfig (the shared union is erased once
 * exported). We use `isToolCallEventType` guards and a small input-shape
 * interface to get precise typing.
 */

import {
	isToolCallEventType,
	type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";

import { inspectBashCommand, inspectWritePath } from "./pre-tool-guard.js";
import { scanForInjection } from "./injection-scan.js";

export { inspectBashCommand, inspectWritePath } from "./pre-tool-guard.js";
export { scanForInjection } from "./injection-scan.js";

interface BashInput {
	command: string;
}
interface WriteInput {
	path: string;
	content: string;
}
interface EditInput {
	path: string;
	edits: Array<{ oldText: string; newText: string }>;
}

export function registerHooks(pi: ExtensionAPI, projectRoot: string): void {
	pi.on("tool_call", async (event) => {
		if (isToolCallEventType("bash", event)) {
			const { command } = event.input as unknown as BashInput;
			const res = inspectBashCommand(command);
			if (res.blocked) {
				return { block: true, reason: `pi-gsd: ${res.reason}` };
			}
			return undefined;
		}

		if (isToolCallEventType("write", event)) {
			const input = event.input as unknown as WriteInput;
			const pathRes = inspectWritePath(input.path, projectRoot);
			if (pathRes.blocked)
				return { block: true, reason: `pi-gsd: ${pathRes.reason}` };
			const scan = scanForInjection(input.content, input.path);
			if (scan.blocked) {
				return {
					block: true,
					reason: `pi-gsd: ${scan.reason} (${scan.matchedPattern})`,
				};
			}
			return undefined;
		}

		if (isToolCallEventType("edit", event)) {
			const input = event.input as unknown as EditInput;
			const pathRes = inspectWritePath(input.path, projectRoot);
			if (pathRes.blocked)
				return { block: true, reason: `pi-gsd: ${pathRes.reason}` };
			for (const e of input.edits) {
				const scan = scanForInjection(e.newText, input.path);
				if (scan.blocked) {
					return {
						block: true,
						reason: `pi-gsd: ${scan.reason} (${scan.matchedPattern})`,
					};
				}
			}
			return undefined;
		}

		return undefined;
	});
}
