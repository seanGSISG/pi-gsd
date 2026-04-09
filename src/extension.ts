/**
 * pi-gsd — modern agentic workflow engine for the pi coding CLI.
 *
 * Phase 1 scaffold: registers a /gsd-hello smoke command so we can confirm
 * the extension loads end-to-end before building the real workflow.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerHelloCommand } from "./commands/hello.js";

export default function piGsd(pi: ExtensionAPI): void {
	registerHelloCommand(pi);
}
