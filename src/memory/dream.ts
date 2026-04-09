/**
 * Dream runner — the Tier 2 consolidation pass.
 *
 * This file implements the gate sequence (time → scan throttle → session
 * → lock) exactly as claude-code's autoDream.ts. The actual "fork an
 * isolated sub-agent with restricted tools and run the 4-phase prompt"
 * step is rendered as a prompt artefact for v1 (same approach as
 * /plan/execute/verify) since pi has no forked-agent primitive. Later
 * phases can swap the body of `runDream` to call the pi-agent SDK
 * directly without changing the public surface.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
	readLastConsolidatedAt,
	rollbackDreamLock,
	stampDreamComplete,
	tryAcquireDreamLock,
} from "./dream-lock.js";
import { buildDreamPrompt } from "./dream-prompt.js";
import { listSessionLogs } from "./session-memory.js";

const SESSION_SCAN_INTERVAL_MS = 10 * 60 * 1000;

export interface DreamConfig {
	minHours: number;
	minSessions: number;
}

export const DREAM_DEFAULTS: DreamConfig = {
	minHours: 8,
	minSessions: 3,
};

export interface DreamGateOutcome {
	fired: boolean;
	reason?: "disabled" | "time" | "scan-throttle" | "sessions" | "lock";
	detail?: string;
	hoursSince?: number;
	sessionsSince?: number;
}

export interface DreamResult extends DreamGateOutcome {
	promptPath?: string;
	memoryRoot?: string;
}

interface DreamRunnerState {
	lastSessionScanAt: number;
}

// Keyed by projectRoot so multiple pi sessions in different repos each
// have their own throttle window.
const STATE = new Map<string, DreamRunnerState>();

function getState(root: string): DreamRunnerState {
	let s = STATE.get(root);
	if (!s) {
		s = { lastSessionScanAt: 0 };
		STATE.set(root, s);
	}
	return s;
}

/**
 * Count the number of distinct session "contributions" to the daily-log
 * stream since the lock mtime. We key on file mtime, not content, so
 * even a single append since the last dream counts a day as "touched".
 */
function countSessionsSince(root: string, sinceMs: number): number {
	const logs = listSessionLogs(root);
	let n = 0;
	for (const path of logs) {
		try {
			const s = statSync(path);
			if (s.mtimeMs > sinceMs) n += 1;
		} catch {
			// ignore
		}
	}
	return n;
}

export interface RunDreamOptions {
	projectRoot: string;
	config?: DreamConfig;
	force?: boolean;
	/**
	 * Bypass the scan throttle for this call. Used by the manual
	 * /gsd-dream command with --force.
	 */
	bypassThrottle?: boolean;
}

/**
 * Run the gate sequence and, if it passes, render a dream prompt and
 * stamp the lock. Returns a structured DreamResult so /gsd-dream can
 * show the user exactly which gate triggered.
 */
export async function runDream(options: RunDreamOptions): Promise<DreamResult> {
	const { projectRoot, force = false } = options;
	const cfg: DreamConfig = options.config ?? DREAM_DEFAULTS;
	const state = getState(projectRoot);
	const memoryRoot = resolve(projectRoot, ".pi-gsd", "memory");

	// --- Time gate ---
	const lastAt = await readLastConsolidatedAt(projectRoot);
	const hoursSince = (Date.now() - lastAt) / 3_600_000;
	if (!force && lastAt > 0 && hoursSince < cfg.minHours) {
		return {
			fired: false,
			reason: "time",
			detail: `${hoursSince.toFixed(1)}h since last dream, need ${cfg.minHours}h`,
			hoursSince,
		};
	}

	// --- Scan throttle ---
	const sinceScanMs = Date.now() - state.lastSessionScanAt;
	if (!force && !options.bypassThrottle && sinceScanMs < SESSION_SCAN_INTERVAL_MS) {
		return {
			fired: false,
			reason: "scan-throttle",
			detail: `last session scan ${Math.round(sinceScanMs / 1000)}s ago`,
		};
	}
	state.lastSessionScanAt = Date.now();

	// --- Session gate ---
	const sessionsSince = countSessionsSince(projectRoot, lastAt);
	if (!force && sessionsSince < cfg.minSessions) {
		return {
			fired: false,
			reason: "sessions",
			detail: `${sessionsSince} session logs since last dream, need ${cfg.minSessions}`,
			hoursSince,
			sessionsSince,
		};
	}

	// --- Lock gate ---
	// Under force, skip acquire and reuse the existing mtime so a failed
	// forced dream doesn't punch a hole in the cooldown timeline.
	let priorMtime: number | null;
	if (force) {
		priorMtime = lastAt;
	} else {
		priorMtime = await tryAcquireDreamLock(projectRoot);
		if (priorMtime === null) {
			return {
				fired: false,
				reason: "lock",
				detail: "another process holds the dream lock",
			};
		}
	}

	try {
		// Build the prompt. Session ids are the relative paths of the logs
		// that advanced since lastAt — stable, human-inspectable, cheap.
		const logs = listSessionLogs(projectRoot);
		const touched = logs.filter((p) => {
			try {
				return statSync(p).mtimeMs > lastAt;
			} catch {
				return false;
			}
		});
		const prompt = buildDreamPrompt({
			memoryRoot,
			projectRoot,
			sessionIds: touched.map((p) => p.replace(projectRoot + "/", "")),
			extra: force
				? "**This is a manual /gsd-dream --force run.** Consolidate even if signal is thin."
				: undefined,
		});

		await mkdir(memoryRoot, { recursive: true });
		const promptPath = resolve(memoryRoot, "dream.prompt.md");
		await writeFile(promptPath, prompt, "utf8");

		// Stamp the lock so cheerleading the user through the prompt
		// counts as "dream started". If the consolidation itself fails,
		// the user can /gsd-dream --force again after fixing it.
		await stampDreamComplete(projectRoot);

		// Also drop a machine-readable log line for observability.
		const logLine =
			JSON.stringify({
				event: "dream_fired",
				ts: new Date().toISOString(),
				hoursSince: Math.round(hoursSince * 10) / 10,
				sessionsSince,
				force,
				promptPath,
			}) + "\n";
		await writeFile(
			resolve(memoryRoot, ".dream.log"),
			logLine,
			{ flag: "a" },
		);

		return {
			fired: true,
			hoursSince,
			sessionsSince,
			promptPath,
			memoryRoot,
		};
	} catch (err) {
		if (!force) await rollbackDreamLock(projectRoot, priorMtime ?? 0);
		throw err;
	}
}

/**
 * Expose whether the memory dir has any daily logs yet — used by the
 * session_shutdown hook to decide whether it's worth even attempting
 * the gate sequence.
 */
export function hasMemoryActivity(projectRoot: string): boolean {
	return existsSync(resolve(projectRoot, ".pi-gsd", "memory", "logs"));
}
