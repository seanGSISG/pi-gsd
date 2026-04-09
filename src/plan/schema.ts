/**
 * Schema for pi-gsd PLAN.md files.
 *
 * Shape: YAML frontmatter (dependency + must-have metadata) + Markdown body
 * (objective, context) + one or more fenced `task` code blocks, each a JSON
 * object describing an atomic unit of work.
 */

import { Type, type Static } from "@sinclair/typebox";

export const MustHaveKind = Type.Union([
	Type.Literal("truth"),
	Type.Literal("artifact"),
	Type.Literal("key_link"),
]);
export type MustHaveKind = Static<typeof MustHaveKind>;

export const MustHave = Type.Object({
	id: Type.String({ minLength: 1 }),
	kind: MustHaveKind,
	statement: Type.String({ minLength: 1 }),
	risk: Type.Optional(
		Type.Union([Type.Literal("normal"), Type.Literal("high")]),
	),
});
export type MustHave = Static<typeof MustHave>;

export const TaskKind = Type.Union([
	Type.Literal("auto"),
	Type.Literal("tdd"),
	Type.Literal("checkpoint"),
]);
export type TaskKind = Static<typeof TaskKind>;

export const Task = Type.Object({
	id: Type.String({ minLength: 1 }),
	name: Type.String({ minLength: 1 }),
	kind: Type.Optional(TaskKind),
	files: Type.Array(Type.String()),
	read_first: Type.Optional(Type.Array(Type.String())),
	action: Type.String({ minLength: 1 }),
	verify: Type.Optional(Type.String()),
	done: Type.String({ minLength: 1 }),
});
export type Task = Static<typeof Task>;

export const PlanFrontmatter = Type.Object({
	phase: Type.String({ minLength: 1 }),
	plan: Type.String({ minLength: 1 }),
	wave: Type.Optional(Type.Integer({ minimum: 1 })),
	depends_on: Type.Optional(Type.Array(Type.String())),
	files_modified: Type.Optional(Type.Array(Type.String())),
	must_haves: Type.Optional(Type.Array(MustHave)),
});
export type PlanFrontmatter = Static<typeof PlanFrontmatter>;

/**
 * Parsed in-memory representation of a PLAN.md file.
 * `objective` is the first H1/H2 body, `context` is any prose before the
 * first fenced task block (after frontmatter). Round-trippable via emitter.
 */
export interface Plan {
	frontmatter: PlanFrontmatter;
	objective: string;
	context: string;
	tasks: Task[];
}
