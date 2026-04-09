import { stringify as yamlStringify } from "yaml";

import type { Plan } from "./schema.js";

/**
 * Emit a Plan back to Markdown. Output is round-trip stable with `parsePlan`
 * for canonical inputs (frontmatter field order matches the schema; task
 * blocks use 2-space indented JSON).
 */
export function emitPlan(plan: Plan): string {
	const fmYaml = yamlStringify(plan.frontmatter, {
		// Preserve array form for readability
		defaultStringType: "PLAIN",
	}).trimEnd();

	const parts: string[] = [];
	parts.push(`---\n${fmYaml}\n---\n`);

	if (plan.objective) {
		parts.push(`\n# Objective\n\n${plan.objective}\n`);
	}
	if (plan.context) {
		parts.push(`\n## Context\n\n${plan.context}\n`);
	}

	parts.push(`\n## Tasks\n`);
	for (const task of plan.tasks) {
		parts.push(`\n\`\`\`task\n${JSON.stringify(task, null, 2)}\n\`\`\`\n`);
	}

	return parts.join("");
}
