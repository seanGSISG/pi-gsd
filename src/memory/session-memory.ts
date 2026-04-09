/**
 * SessionMemory — Tier 1 of the two-tier memory system. Lightweight
 * append-only capture that fires at session shutdown and at phase
 * completion hooks. No consolidation, no LLM — just a durable daily log
 * the dream pass will later consume.
 *
 * File layout: .pi-gsd/memory/logs/YYYY/MM/YYYY-MM-DD.md
 * Each append is a dated heading + free-form markdown body.
 */

import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface SessionMemoryAppend {
	source: string; // e.g. "phase-07/execute", "session-shutdown"
	body: string; // the markdown content
	timestamp?: Date;
}

export function dailyLogPath(
	projectRoot: string,
	d: Date = new Date(),
): string {
	const y = String(d.getUTCFullYear());
	const m = String(d.getUTCMonth() + 1).padStart(2, "0");
	const day = String(d.getUTCDate()).padStart(2, "0");
	return resolve(
		projectRoot,
		".pi-gsd",
		"memory",
		"logs",
		y,
		m,
		`${y}-${m}-${day}.md`,
	);
}

export async function appendSessionMemory(
	projectRoot: string,
	entry: SessionMemoryAppend,
): Promise<string> {
	const ts = entry.timestamp ?? new Date();
	const path = dailyLogPath(projectRoot, ts);
	await mkdir(dirname(path), { recursive: true });
	const block = `\n## ${ts.toISOString()} — ${entry.source}\n\n${entry.body.trim()}\n`;
	await appendFile(path, block, "utf8");
	return path;
}

export function listSessionLogs(projectRoot: string): string[] {
	const root = resolve(projectRoot, ".pi-gsd", "memory", "logs");
	if (!existsSync(root)) return [];
	const found: string[] = [];
	const walk = (dir: string): void => {
		try {
			const entries = require("node:fs").readdirSync(dir, {
				withFileTypes: true,
			}) as Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
			for (const e of entries) {
				const p = resolve(dir, e.name);
				if (e.isDirectory()) walk(p);
				else if (e.isFile() && e.name.endsWith(".md")) found.push(p);
			}
		} catch {
			// ignore
		}
	};
	walk(root);
	return found.sort();
}

/**
 * Read the concatenated body of every daily log (for tests and for the
 * dream runner's session-count gate).
 */
export function readAllSessionLogs(projectRoot: string): string {
	return listSessionLogs(projectRoot)
		.map((p) => readFileSync(p, "utf8"))
		.join("\n\n");
}
