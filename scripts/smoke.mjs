// Smoke test: load pi-gsd the same way pi's ResourceLoader does and
// enumerate the commands it registered. Proves the extension works at
// runtime, not just at typecheck time.

import { DefaultResourceLoader } from "@mariozechner/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const extPath = resolve(here, "..", "dist", "extension.js");

const loader = new DefaultResourceLoader({
	additionalExtensionPaths: [extPath],
});

await loader.reload();
const result = loader.getExtensions();
console.log(
	`loaded ${result.extensions.length} extension(s), errors: ${result.errors.length}`,
);
for (const e of result.errors) {
	console.error(" error:", e.path, e.error?.message ?? e.error);
}

// Enumerate commands each loaded extension registered (read directly off
// Extension objects — runtime.getCommands() isn't safe to call outside a
// live session).
const ours = result.extensions.find((e) =>
	(e.sourceInfo?.path ?? "").includes("pi-gsd") ||
	(e.sourceInfo?.path ?? "").endsWith("dist/extension.js"),
);
console.log("pi-gsd extension found:", !!ours);
const cmdMap = ours?.commands instanceof Map ? ours.commands : new Map();
console.log(`pi-gsd registered ${cmdMap.size} command(s):`);
for (const [name, cmd] of cmdMap) {
	console.log(`  /${name}  —  ${cmd.description ?? "(no description)"}`);
}

const ok = result.errors.length === 0 && !!ours && cmdMap.has("gsd-hello");
console.log(ok ? "SMOKE: PASS" : "SMOKE: FAIL");
process.exit(ok ? 0 : 1);
