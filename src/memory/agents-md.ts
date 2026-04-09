/**
 * AGENTS.md — living, human-editable project memory. Loaded into every
 * sub-agent's system context. We never silently rewrite it; operations are
 * limited to reading and appending structured sections.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function agentsPath(projectRoot: string): string {
	return resolve(projectRoot, ".pi-gsd", "AGENTS.md");
}

export function readAgentsMd(projectRoot: string): string {
	const path = agentsPath(projectRoot);
	if (!existsSync(path)) return "";
	return readFileSync(path, "utf8");
}

export async function ensureAgentsMd(
	projectRoot: string,
	seed: { projectName: string; summary: string },
): Promise<void> {
	const path = agentsPath(projectRoot);
	if (existsSync(path)) return;
	await mkdir(dirname(path), { recursive: true });
	const body = `# ${seed.projectName}

${seed.summary}

## Tech stack
_Edit this section with your language, framework, and key dependencies._

## Architectural decisions
_Add one-line entries as decisions are made._

## Known pitfalls
_Record gotchas so future phases don't re-learn them the hard way._
`;
	await writeFile(path, body, "utf8");
}

export async function appendAgentsSection(
	projectRoot: string,
	heading: string,
	body: string,
): Promise<void> {
	const path = agentsPath(projectRoot);
	const current = existsSync(path) ? readFileSync(path, "utf8") : "";
	const next = `${current.trimEnd()}\n\n## ${heading}\n\n${body.trim()}\n`;
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, next, "utf8");
}
