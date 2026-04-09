import { describe, it, expect } from "vitest";

import {
	schedulePlans,
	ScheduleError,
	type PlanRef,
} from "../src/orchestrator/wave-scheduler.js";

describe("schedulePlans", () => {
	it("puts plans with no deps in wave 1", () => {
		const plans: PlanRef[] = [
			{ plan: "01-01", files_modified: ["a.ts"] },
			{ plan: "01-02", files_modified: ["b.ts"] },
		];
		const r = schedulePlans(plans);
		expect(r.waves).toHaveLength(1);
		expect(r.waves[0]!.index).toBe(1);
		expect(r.waves[0]!.plans).toEqual(["01-01", "01-02"]);
		expect(r.waves[0]!.conflicts).toHaveLength(0);
	});

	it("stacks waves according to dependencies", () => {
		const plans: PlanRef[] = [
			{ plan: "01", files_modified: ["a.ts"] },
			{ plan: "02", depends_on: ["01"], files_modified: ["b.ts"] },
			{ plan: "03", depends_on: ["01"], files_modified: ["c.ts"] },
			{ plan: "04", depends_on: ["02", "03"], files_modified: ["d.ts"] },
		];
		const r = schedulePlans(plans);
		expect(r.waves.map((w) => w.plans)).toEqual([["01"], ["02", "03"], ["04"]]);
	});

	it("flags file-overlap conflicts within a wave", () => {
		const plans: PlanRef[] = [
			{ plan: "01", files_modified: ["shared.ts", "a.ts"] },
			{ plan: "02", files_modified: ["shared.ts", "b.ts"] },
		];
		const r = schedulePlans(plans);
		expect(r.waves[0]!.conflicts).toHaveLength(1);
		expect(r.waves[0]!.conflicts[0]!.files).toEqual(["shared.ts"]);
		expect(r.waves[0]!.conflicts[0]!.a).toBe("01");
		expect(r.waves[0]!.conflicts[0]!.b).toBe("02");
	});

	it("does not flag cross-wave overlaps (dependencies already sequence them)", () => {
		const plans: PlanRef[] = [
			{ plan: "01", files_modified: ["x.ts"] },
			{ plan: "02", depends_on: ["01"], files_modified: ["x.ts"] },
		];
		const r = schedulePlans(plans);
		expect(r.waves.flatMap((w) => w.conflicts)).toHaveLength(0);
	});

	it("detects cycles", () => {
		const plans: PlanRef[] = [
			{ plan: "01", depends_on: ["02"] },
			{ plan: "02", depends_on: ["01"] },
		];
		expect(() => schedulePlans(plans)).toThrow(ScheduleError);
		expect(() => schedulePlans(plans)).toThrow(/cycle detected/);
	});

	it("detects unknown dependencies", () => {
		const plans: PlanRef[] = [{ plan: "01", depends_on: ["missing"] }];
		expect(() => schedulePlans(plans)).toThrow(/unknown plan: missing/);
	});

	it("detects duplicate plan ids", () => {
		const plans: PlanRef[] = [{ plan: "01" }, { plan: "01" }];
		expect(() => schedulePlans(plans)).toThrow(/duplicate plan id/);
	});

	it("produces a deterministic topological order", () => {
		const plans: PlanRef[] = [
			{ plan: "c" },
			{ plan: "a" },
			{ plan: "b", depends_on: ["a"] },
		];
		const r = schedulePlans(plans);
		// Ready queue stays sorted as new plans become ready: a and c are
		// initially ready; a unlocks b; b slots before c alphabetically.
		expect(r.order).toEqual(["a", "b", "c"]);
	});
});
