/**
 * /gsd-memory — view the memory index and list topic files. Quick way to
 * inspect what the dream loop has consolidated so far.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

export function registerMemoryCommand(pi: ExtensionAPI): void {
	pi.registerCommand("gsd-memory", {
		description: "View .pi-gsd/memory/MEMORY.md and list topic files",
		handler: async (_args, ctx) => {
			const root = ctx.cwd ?? process.cwd();
			const memDir = resolve(root, ".pi-gsd", "memory");
			if (!existsSync(memDir)) {
				ctx.ui.notify(
					`no memory directory yet: ${memDir}. Run /gsd-dream after some phase activity.`,
					"info",
				);
				return;
			}
			const lines: string[] = [`memory: ${memDir}`];

			const indexPath = resolve(memDir, "MEMORY.md");
			if (existsSync(indexPath)) {
				const idx = readFileSync(indexPath, "utf8").trim();
				lines.push("", "── MEMORY.md ──", idx);
			} else {
				lines.push("", "(no MEMORY.md yet)");
			}

			const topics = readdirSync(memDir, { withFileTypes: true })
				.filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "MEMORY.md")
				.map((e) => e.name)
				.sort();
			if (topics.length > 0) {
				lines.push("", "── Topic files ──", ...topics.map((t) => `  - ${t}`));
			}

			const logDir = resolve(memDir, "logs");
			if (existsSync(logDir)) {
				const count = walkCount(logDir);
				lines.push("", `── Daily logs ── ${count} file(s)`);
			}

			const lockPath = resolve(memDir, ".dream-lock");
			if (existsSync(lockPath)) {
				const s = statSync(lockPath);
				const hoursAgo = (Date.now() - s.mtimeMs) / 3_600_000;
				lines.push(`── Last dream ── ${hoursAgo.toFixed(1)}h ago`);
			} else {
				lines.push("── Last dream ── never");
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}

function walkCount(dir: string): number {
	let n = 0;
	const stack = [dir];
	while (stack.length > 0) {
		const d = stack.pop()!;
		try {
			for (const e of readdirSync(d, { withFileTypes: true })) {
				const p = resolve(d, e.name);
				if (e.isDirectory()) stack.push(p);
				else if (e.isFile() && e.name.endsWith(".md")) n += 1;
			}
		} catch {
			// ignore
		}
	}
	return n;
}
