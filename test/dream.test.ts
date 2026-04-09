import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, utimes, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

import { runDream, DREAM_DEFAULTS } from "../src/memory/dream.js";
import { appendSessionMemory } from "../src/memory/session-memory.js";

async function writeAgedLog(root: string, daysAgo: number): Promise<void> {
	const d = new Date(Date.now() - daysAgo * 24 * 3_600_000);
	await appendSessionMemory(root, {
		source: "test",
		body: `log for ${d.toISOString()}`,
		timestamp: d,
	});
}

describe("runDream gates", () => {
	let root: string;
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "pigsd-dream-"));
	});

	it("fires on a cold project with --force", async () => {
		const r = await runDream({ projectRoot: root, force: true });
		expect(r.fired).toBe(true);
		expect(r.promptPath).toBeDefined();
		expect(existsSync(r.promptPath!)).toBe(true);
		expect(readFileSync(r.promptPath!, "utf8")).toContain("Dream: Memory Consolidation");
	});

	it("respects the session gate when not forced", async () => {
		// No logs yet — session gate rejects.
		const r = await runDream({
			projectRoot: root,
			config: { minHours: 0, minSessions: 3 },
			bypassThrottle: true,
		});
		expect(r.fired).toBe(false);
		expect(r.reason).toBe("sessions");
	});

	it("fires when enough session log files accumulate", async () => {
		// Session gate counts distinct daily-log files touched since the
		// last dream. Simulate four separate days so four files appear.
		for (let i = 0; i < 4; i++) {
			await appendSessionMemory(root, {
				source: `test-${i}`,
				body: `body ${i}`,
				timestamp: new Date(Date.now() - i * 24 * 3_600_000),
			});
		}
		const r = await runDream({
			projectRoot: root,
			config: { minHours: 0, minSessions: 3 },
			bypassThrottle: true,
		});
		expect(r.fired).toBe(true);
	});

	it("respects the time gate when a recent dream already ran", async () => {
		// Force-fire once to stamp the lock with "now".
		const first = await runDream({ projectRoot: root, force: true });
		expect(first.fired).toBe(true);
		// Second call without force should hit the time gate (default 8h).
		const second = await runDream({
			projectRoot: root,
			config: DREAM_DEFAULTS,
			bypassThrottle: true,
		});
		expect(second.fired).toBe(false);
		expect(second.reason).toBe("time");
	});

	it("writes an observability log line on fire", async () => {
		await runDream({ projectRoot: root, force: true });
		const logPath = join(root, ".pi-gsd", "memory", ".dream.log");
		expect(existsSync(logPath)).toBe(true);
		const logRaw = readFileSync(logPath, "utf8").trim();
		const parsed = JSON.parse(logRaw);
		expect(parsed.event).toBe("dream_fired");
		expect(parsed.force).toBe(true);
	});
});

describe("session memory append", () => {
	it("writes a dated daily log and multiple appends coexist", async () => {
		const root = await mkdtemp(join(tmpdir(), "pigsd-sm-"));
		const p1 = await appendSessionMemory(root, {
			source: "phase-01/execute",
			body: "did a thing",
		});
		const p2 = await appendSessionMemory(root, {
			source: "phase-02/verify",
			body: "checked a thing",
		});
		expect(p1).toBe(p2); // same day
		const raw = readFileSync(p1, "utf8");
		expect(raw).toContain("phase-01/execute");
		expect(raw).toContain("phase-02/verify");
	});
});
