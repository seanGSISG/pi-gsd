/**
 * STATE.md reader/writer. STATE.md is the ephemeral-position file — current
 * phase, last activity timestamp, metrics. Kept short (<100 lines) and
 * rewritten atomically with a .backup sibling.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface ProjectState {
	currentPhase: string | null;
	currentPlan: string | null;
	status: string;
	lastActivity: string; // ISO timestamp
	plansCompleted: number;
	lastSummary: string;
}

const STATE_HEADER = "# pi-gsd State\n\n";

const EMPTY_STATE: ProjectState = {
	currentPhase: null,
	currentPlan: null,
	status: "idle",
	lastActivity: new Date(0).toISOString(),
	plansCompleted: 0,
	lastSummary: "",
};

function stateFilePath(projectRoot: string): string {
	return resolve(projectRoot, ".pi-gsd", "STATE.md");
}

export function readState(projectRoot: string): ProjectState {
	const path = stateFilePath(projectRoot);
	if (!existsSync(path)) return { ...EMPTY_STATE };
	const raw = readFileSync(path, "utf8");
	return parseStateMarkdown(raw);
}

/**
 * Parse the subset of STATE.md we care about. STATE.md is markdown for
 * humans, so parsing is forgiving — unknown lines are ignored.
 */
export function parseStateMarkdown(raw: string): ProjectState {
	const out: ProjectState = { ...EMPTY_STATE };
	const lines = raw.split(/\r?\n/);
	const kv = /^\s*-?\s*([A-Za-z ]+):\s*(.*)$/;
	for (const line of lines) {
		const m = line.match(kv);
		if (!m) continue;
		const key = (m[1] ?? "").trim().toLowerCase();
		const val = (m[2] ?? "").trim();
		switch (key) {
			case "current phase":
				out.currentPhase = val || null;
				break;
			case "current plan":
				out.currentPlan = val || null;
				break;
			case "status":
				out.status = val;
				break;
			case "last activity":
				out.lastActivity = val;
				break;
			case "plans completed":
				out.plansCompleted = Number.parseInt(val, 10) || 0;
				break;
			case "last summary":
				out.lastSummary = val;
				break;
		}
	}
	return out;
}

export function formatStateMarkdown(state: ProjectState): string {
	return (
		STATE_HEADER +
		[
			`- Current phase: ${state.currentPhase ?? ""}`,
			`- Current plan: ${state.currentPlan ?? ""}`,
			`- Status: ${state.status}`,
			`- Last activity: ${state.lastActivity}`,
			`- Plans completed: ${state.plansCompleted}`,
			`- Last summary: ${state.lastSummary}`,
		].join("\n") +
		"\n"
	);
}

/**
 * Write STATE.md atomically. Backs up the previous file to STATE.md.backup,
 * writes the new content to STATE.md.tmp, then renames into place so a
 * crashed writer never leaves a half-written STATE.md.
 */
export async function writeState(
	projectRoot: string,
	state: ProjectState,
): Promise<void> {
	const path = stateFilePath(projectRoot);
	await mkdir(dirname(path), { recursive: true });
	if (existsSync(path)) {
		await copyFile(path, `${path}.backup`);
	}
	const tmp = `${path}.tmp`;
	await writeFile(tmp, formatStateMarkdown(state), "utf8");
	await rename(tmp, path);
}

export async function patchState(
	projectRoot: string,
	patch: Partial<ProjectState>,
): Promise<ProjectState> {
	const cur = readState(projectRoot);
	const next: ProjectState = {
		...cur,
		...patch,
		lastActivity: new Date().toISOString(),
	};
	await writeState(projectRoot, next);
	return next;
}
