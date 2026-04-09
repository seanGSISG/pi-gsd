import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

import {
	HOLDER_STALE_MS,
	isProcessRunning,
	readLastConsolidatedAt,
	rollbackDreamLock,
	stampDreamComplete,
	tryAcquireDreamLock,
} from "../src/memory/dream-lock.js";

describe("dream lock", () => {
	let root: string;
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "pigsd-dream-lock-"));
	});

	it("reports 0 when no lock file exists", async () => {
		expect(await readLastConsolidatedAt(root)).toBe(0);
	});

	it("tryAcquire returns 0 on first acquire, bumps mtime", async () => {
		const prior = await tryAcquireDreamLock(root);
		expect(prior).toBe(0);
		const now = await readLastConsolidatedAt(root);
		expect(now).toBeGreaterThan(0);
	});

	it("blocks second acquire while the first process is alive", async () => {
		const first = await tryAcquireDreamLock(root);
		expect(first).toBe(0);
		// Second caller in the SAME process — the PID matches self, so
		// the liveness check returns true → blocked.
		const second = await tryAcquireDreamLock(root);
		expect(second).toBeNull();
	});

	it("reclaims a stale lock (mtime older than HOLDER_STALE_MS)", async () => {
		await tryAcquireDreamLock(root);
		const lockPath = join(root, ".pi-gsd", "memory", ".dream-lock");
		const old = Date.now() / 1000 - (HOLDER_STALE_MS / 1000) - 10;
		await utimes(lockPath, old, old);
		// Even though the PID body is still our live pid, the mtime is
		// beyond the stale window so reclamation proceeds.
		const prior = await tryAcquireDreamLock(root);
		expect(prior).not.toBeNull();
	});

	it("rollback rewinds mtime to the prior value", async () => {
		const prior = await tryAcquireDreamLock(root);
		expect(prior).toBe(0);
		const lockPath = join(root, ".pi-gsd", "memory", ".dream-lock");
		// Acquire once, rollback, and confirm the file is gone again.
		await rollbackDreamLock(root, 0);
		expect(existsSync(lockPath)).toBe(false);
	});

	it("stampDreamComplete clears the PID body", async () => {
		await tryAcquireDreamLock(root);
		await stampDreamComplete(root);
		const raw = await readFile(
			join(root, ".pi-gsd", "memory", ".dream-lock"),
			"utf8",
		);
		expect(raw).toBe("");
	});

	it("isProcessRunning returns true for self", () => {
		expect(isProcessRunning(process.pid)).toBe(true);
	});
});
