/**
 * pi-gsd — modern agentic workflow engine for the pi coding CLI.
 *
 * Extension entry point. Registers commands and deterministic safety hooks
 * into the pi session. Phases 1–4 so far: /gsd-hello smoke command and the
 * pre-tool guard + prompt-injection scanner.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerHelloCommand } from "./commands/hello.js";
import { registerInitCommand } from "./commands/init.js";
import { registerDiscussCommand } from "./commands/discuss.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerHooks } from "./hooks/index.js";

export default function piGsd(pi: ExtensionAPI): void {
	registerHelloCommand(pi);
	registerInitCommand(pi);
	registerDiscussCommand(pi);
	registerPlanCommand(pi);
	registerHooks(pi, process.cwd());
}
