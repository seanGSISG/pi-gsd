import { describe, expect, it } from "vitest";

import { emitPlan } from "../src/plan/emitter.js";
import { parsePlan, PlanParseError } from "../src/plan/parser.js";
import type { Plan } from "../src/plan/schema.js";

const SAMPLE: Plan = {
	frontmatter: {
		phase: "01",
		plan: "01-01",
		wave: 1,
		depends_on: [],
		files_modified: ["src/foo.ts"],
		must_haves: [
			{ id: "mh-1", kind: "truth", statement: "foo() is exported", risk: "normal" },
			{
				id: "mh-2",
				kind: "artifact",
				statement: "src/foo.ts exists",
			},
		],
	},
	objective: "Create the foo module.",
	context: "Part of the bootstrap phase.",
	tasks: [
		{
			id: "t1",
			name: "Create foo.ts",
			kind: "auto",
			files: ["src/foo.ts"],
			read_first: ["src/index.ts"],
			action: "Write src/foo.ts exporting foo(): string that returns 'ok'.",
			verify: "grep -q 'export function foo' src/foo.ts",
			done: "src/foo.ts exists and exports foo",
		},
	],
};

describe("plan parser", () => {
	it("emits and reparses to the same shape", () => {
		const emitted = emitPlan(SAMPLE);
		const reparsed = parsePlan(emitted);
		expect(reparsed.frontmatter).toEqual(SAMPLE.frontmatter);
		expect(reparsed.objective).toBe(SAMPLE.objective);
		expect(reparsed.context).toBe(SAMPLE.context);
		expect(reparsed.tasks).toEqual(SAMPLE.tasks);
	});

	it("is stable over a second round-trip", () => {
		const first = emitPlan(SAMPLE);
		const second = emitPlan(parsePlan(first));
		expect(second).toBe(first);
	});

	it("rejects missing frontmatter", () => {
		expect(() => parsePlan("# Objective\n\nthing\n")).toThrow(PlanParseError);
	});

	it("rejects plans with no tasks", () => {
		const noTasks = `---\nphase: "01"\nplan: "01-01"\n---\n\n# Objective\n\nnothing\n`;
		expect(() => parsePlan(noTasks)).toThrow(/no .task. fenced blocks/);
	});

	it("rejects duplicate task ids", () => {
		const dup = `---
phase: "01"
plan: "01-01"
---

## Tasks

\`\`\`task
{"id":"a","name":"n","files":[],"action":"x","done":"y"}
\`\`\`

\`\`\`task
{"id":"a","name":"n2","files":[],"action":"x","done":"y"}
\`\`\`
`;
		expect(() => parsePlan(dup)).toThrow(/duplicate task id/);
	});

	it("rejects malformed task JSON with a clear error", () => {
		const broken = `---
phase: "01"
plan: "01-01"
---

\`\`\`task
{not json}
\`\`\`
`;
		expect(() => parsePlan(broken)).toThrow(/task block JSON/);
	});

	it("rejects frontmatter schema violations", () => {
		// missing `phase`
		const bad = `---\nplan: "01-01"\n---\n\n\`\`\`task\n{"id":"a","name":"n","files":[],"action":"x","done":"y"}\n\`\`\`\n`;
		expect(() => parsePlan(bad)).toThrow(/frontmatter schema/);
	});
});
