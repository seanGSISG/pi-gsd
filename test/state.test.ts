import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import {
	formatStateMarkdown,
	parseStateMarkdown,
	patchState,
	readState,
	writeState,
} from "../src/memory/state.js";

describe("state round-trip", () => {
	let root: string;
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "pigsd-state-"));
	});

	it("read from empty returns defaults", () => {
		const s = readState(root);
		expect(s.currentPhase).toBe(null);
		expect(s.status).toBe("idle");
	});

	it("writeState creates .pi-gsd/STATE.md and round-trips", async () => {
		await writeState(root, {
			currentPhase: "02",
			currentPlan: "02-01",
			status: "executing",
			lastActivity: "2026-04-08T20:00:00.000Z",
			plansCompleted: 3,
			lastSummary: "finished plan 02-01",
		});
		expect(existsSync(join(root, ".pi-gsd", "STATE.md"))).toBe(true);
		const reread = readState(root);
		expect(reread.currentPhase).toBe("02");
		expect(reread.plansCompleted).toBe(3);
		expect(reread.status).toBe("executing");
	});

	it("patchState bumps lastActivity and merges fields", async () => {
		await writeState(root, {
			currentPhase: "01",
			currentPlan: null,
			status: "idle",
			lastActivity: "2026-01-01T00:00:00.000Z",
			plansCompleted: 0,
			lastSummary: "",
		});
		const before = readState(root).lastActivity;
		await new Promise((r) => setTimeout(r, 5));
		const after = await patchState(root, { status: "planning" });
		expect(after.status).toBe("planning");
		expect(after.currentPhase).toBe("01");
		expect(after.lastActivity).not.toBe(before);
	});

	it("creates .backup on overwrite", async () => {
		await writeState(root, {
			currentPhase: "01",
			currentPlan: null,
			status: "idle",
			lastActivity: "2026-01-01T00:00:00.000Z",
			plansCompleted: 0,
			lastSummary: "",
		});
		await writeState(root, {
			currentPhase: "02",
			currentPlan: null,
			status: "idle",
			lastActivity: "2026-01-02T00:00:00.000Z",
			plansCompleted: 1,
			lastSummary: "",
		});
		expect(existsSync(join(root, ".pi-gsd", "STATE.md.backup"))).toBe(true);
	});

	it("formatStateMarkdown and parseStateMarkdown are inverse", () => {
		const s = {
			currentPhase: "05",
			currentPlan: "05-02",
			status: "verifying",
			lastActivity: "2026-04-08T20:00:00.000Z",
			plansCompleted: 12,
			lastSummary: "wip",
		};
		const md = formatStateMarkdown(s);
		const back = parseStateMarkdown(md);
		expect(back).toEqual(s);
	});
});
