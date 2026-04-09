import { parse as parseYaml } from "yaml";
import { Value } from "@sinclair/typebox/value";

import {
	PlanFrontmatter,
	Task,
	type Plan,
	type PlanFrontmatter as PlanFrontmatterT,
	type Task as TaskT,
} from "./schema.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const TASK_BLOCK_RE = /```task\s*\n([\s\S]*?)\n```/g;
const OBJECTIVE_RE = /^#{1,2}\s*Objective\s*\n+([\s\S]*?)(?=\n#{1,2}\s|\n```task|$)/im;
const CONTEXT_RE = /^#{1,2}\s*Context\s*\n+([\s\S]*?)(?=\n#{1,2}\s|\n```task|$)/im;

export class PlanParseError extends Error {
	constructor(
		message: string,
		public readonly path?: string,
	) {
		super(path ? `${path}: ${message}` : message);
		this.name = "PlanParseError";
	}
}

/**
 * Parse PLAN.md source text into a Plan. Throws PlanParseError with a clear
 * message on malformed frontmatter, malformed task JSON, or schema violations.
 */
export function parsePlan(source: string, path?: string): Plan {
	const fmMatch = source.match(FRONTMATTER_RE);
	if (!fmMatch) {
		throw new PlanParseError("missing YAML frontmatter", path);
	}
	const fmText = fmMatch[1] ?? "";
	let fmRaw: unknown;
	try {
		fmRaw = parseYaml(fmText);
	} catch (err) {
		throw new PlanParseError(
			`invalid YAML frontmatter: ${(err as Error).message}`,
			path,
		);
	}
	if (!Value.Check(PlanFrontmatter, fmRaw)) {
		const firstError = [...Value.Errors(PlanFrontmatter, fmRaw)][0];
		throw new PlanParseError(
			`frontmatter schema: ${firstError?.path ?? ""} ${firstError?.message ?? "unknown error"}`,
			path,
		);
	}
	const frontmatter: PlanFrontmatterT = fmRaw;

	const body = source.slice(fmMatch[0].length);

	const objective = (body.match(OBJECTIVE_RE)?.[1] ?? "").trim();
	const context = (body.match(CONTEXT_RE)?.[1] ?? "").trim();

	const tasks: TaskT[] = [];
	const seenIds = new Set<string>();
	for (const match of body.matchAll(TASK_BLOCK_RE)) {
		const jsonText = match[1] ?? "";
		let parsed: unknown;
		try {
			parsed = JSON.parse(jsonText);
		} catch (err) {
			throw new PlanParseError(
				`task block JSON: ${(err as Error).message}`,
				path,
			);
		}
		if (!Value.Check(Task, parsed)) {
			const firstError = [...Value.Errors(Task, parsed)][0];
			throw new PlanParseError(
				`task schema: ${firstError?.path ?? ""} ${firstError?.message ?? "unknown"}`,
				path,
			);
		}
		const task: TaskT = parsed;
		if (seenIds.has(task.id)) {
			throw new PlanParseError(`duplicate task id: ${task.id}`, path);
		}
		seenIds.add(task.id);
		tasks.push(task);
	}

	if (tasks.length === 0) {
		throw new PlanParseError("plan has no `task` fenced blocks", path);
	}

	return { frontmatter, objective, context, tasks };
}
