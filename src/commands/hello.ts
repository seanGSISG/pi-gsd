import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const VERSION = "0.1.0";

export function registerHelloCommand(pi: ExtensionAPI): void {
	pi.registerCommand("gsd-hello", {
		description: "pi-gsd smoke test — confirms the extension is loaded",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`pi-gsd v${VERSION} loaded. Workflow commands come online in later phases.`,
				"info",
			);
		},
	});
}
