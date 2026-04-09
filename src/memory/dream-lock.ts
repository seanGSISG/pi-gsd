/**
 * Dream lock — port of claude-code's consolidationLock.ts.
 *
 * Lock file whose mtime IS lastConsolidatedAt, body is the holder's PID.
 * Lives at .pi-gsd/memory/.dream-lock. Three properties:
 *
 *   1. Cheap per-turn read: one stat() → mtime → hours-since-last-dream.
 *   2. Mutual exclusion with PID-based liveness and a 60-minute stale
 *      guard, so a crashed dream doesn't block future dreams forever.
 *   3. Rollback on a failed fork: restore the prior mtime so the next
 *      attempt isn't cooled-down by a no-op acquire.
 */

import { existsSync } from "node:fs";
import {
	mkdir,
	readFile,
	stat,
	unlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const HOLDER_STALE_MS = 60 * 60 * 1000;
const LOCK_FILE = ".dream-lock";

function lockPath(projectRoot: string): string {
	return resolve(projectRoot, ".pi-gsd", "memory", LOCK_FILE);
}

/**
 * Returns true if the given PID is currently running on this host.
 * Node's `process.kill(pid, 0)` throws if the process is dead; we use
 * that without delivering any signal.
 */
export function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Read the lock file's mtime. Returns 0 when absent.
 */
export async function readLastConsolidatedAt(
	projectRoot: string,
): Promise<number> {
	try {
		const s = await stat(lockPath(projectRoot));
		return s.mtimeMs;
	} catch {
		return 0;
	}
}

/**
 * Acquire the dream lock. Writes this process's PID and bumps mtime to
 * `now`. Returns the PRE-acquire mtime (for rollback) on success, or
 * null if another live process holds the lock.
 */
export async function tryAcquireDreamLock(
	projectRoot: string,
): Promise<number | null> {
	const path = lockPath(projectRoot);
	let mtimeMs: number | undefined;
	let holderPid: number | undefined;

	if (existsSync(path)) {
		try {
			const [s, raw] = await Promise.all([stat(path), readFile(path, "utf8")]);
			mtimeMs = s.mtimeMs;
			const parsed = Number.parseInt(raw.trim(), 10);
			holderPid = Number.isFinite(parsed) ? parsed : undefined;
		} catch {
			// race — treat as no lock
		}
	}

	if (mtimeMs !== undefined && Date.now() - mtimeMs < HOLDER_STALE_MS) {
		if (holderPid !== undefined && isProcessRunning(holderPid)) {
			return null;
		}
		// dead PID or unparseable body — reclaim
	}

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, String(process.pid));

	// Two reclaimers race: last writer wins, loser bails on re-read.
	let verify: string;
	try {
		verify = await readFile(path, "utf8");
	} catch {
		return null;
	}
	if (Number.parseInt(verify.trim(), 10) !== process.pid) return null;

	return mtimeMs ?? 0;
}

/**
 * Rewind the lock to the pre-acquire state after a failed dream. Clears
 * the PID body so our still-running process doesn't look like a holder.
 * priorMtime=0 → unlink (restore no-file).
 */
export async function rollbackDreamLock(
	projectRoot: string,
	priorMtime: number,
): Promise<void> {
	const path = lockPath(projectRoot);
	try {
		if (priorMtime === 0) {
			await unlink(path);
			return;
		}
		await writeFile(path, "");
		const t = priorMtime / 1000; // utimes wants seconds
		await utimes(path, t, t);
	} catch {
		// best-effort — next dream is merely delayed by minHours
	}
}

/**
 * Mark a dream as complete by bumping the lock's mtime to now, with the
 * PID body cleared so liveness checks won't think we're still running.
 */
export async function stampDreamComplete(projectRoot: string): Promise<void> {
	const path = lockPath(projectRoot);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, "");
	const now = Date.now() / 1000;
	await utimes(path, now, now);
}
