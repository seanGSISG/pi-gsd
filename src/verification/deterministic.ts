/**
 * Layer 1 verification: deterministic checks. Runs the project's own
 * quality gates (tests, linter, typechecker) and returns a structured
 * verdict. No LLM involvement — this layer must be fast and cheap so it
 * always runs first.
 *
 * We auto-detect the check commands from common project files. Callers
 * can override via .pi-gsd/config.json `verify` field in a later phase.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

export interface CheckResult {
	name: string;
	command: string;
	status: "pass" | "fail" | "skip";
	durationMs: number;
	output: string;
}

export interface DeterministicReport {
	overall: "pass" | "fail" | "skip";
	checks: CheckResult[];
}

async function runCheck(
	name: string,
	command: string,
	cwd: string,
): Promise<CheckResult> {
	const start = Date.now();
	try {
		const { stdout, stderr } = await pExecFile("sh", ["-c", command], {
			cwd,
			maxBuffer: 16 * 1024 * 1024,
			env: { ...process.env, CI: "1" },
		});
		return {
			name,
			command,
			status: "pass",
			durationMs: Date.now() - start,
			output: (stdout || stderr || "").slice(0, 2000),
		};
	} catch (err) {
		const e = err as { stdout?: string; stderr?: string; message?: string };
		return {
			name,
			command,
			status: "fail",
			durationMs: Date.now() - start,
			output: (e.stdout || e.stderr || e.message || "").toString().slice(0, 4000),
		};
	}
}

function detectNodeProject(root: string): {
	hasTest: boolean;
	hasLint: boolean;
	hasTypecheck: boolean;
} {
	const pkgPath = resolve(root, "package.json");
	if (!existsSync(pkgPath)) {
		return { hasTest: false, hasLint: false, hasTypecheck: false };
	}
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
			scripts?: Record<string, string>;
		};
		const scripts = pkg.scripts ?? {};
		return {
			hasTest: "test" in scripts,
			hasLint: "lint" in scripts,
			hasTypecheck: "typecheck" in scripts,
		};
	} catch {
		return { hasTest: false, hasLint: false, hasTypecheck: false };
	}
}

/**
 * Run whichever deterministic checks this project supports. Skipped
 * checks are recorded explicitly so a verifier sub-agent can see the
 * full picture.
 */
export async function runDeterministicChecks(
	root: string,
): Promise<DeterministicReport> {
	const checks: CheckResult[] = [];
	const node = detectNodeProject(root);

	if (node.hasTypecheck) {
		checks.push(await runCheck("typecheck", "npm run -s typecheck", root));
	} else {
		checks.push({
			name: "typecheck",
			command: "",
			status: "skip",
			durationMs: 0,
			output: "no typecheck script",
		});
	}
	if (node.hasLint) {
		checks.push(await runCheck("lint", "npm run -s lint", root));
	} else {
		checks.push({
			name: "lint",
			command: "",
			status: "skip",
			durationMs: 0,
			output: "no lint script",
		});
	}
	if (node.hasTest) {
		checks.push(await runCheck("test", "npm test --silent", root));
	} else {
		checks.push({
			name: "test",
			command: "",
			status: "skip",
			durationMs: 0,
			output: "no test script",
		});
	}

	const hasFail = checks.some((c) => c.status === "fail");
	const hasPass = checks.some((c) => c.status === "pass");
	const overall: DeterministicReport["overall"] = hasFail
		? "fail"
		: hasPass
			? "pass"
			: "skip";
	return { overall, checks };
}

export function formatReportMarkdown(report: DeterministicReport): string {
	const lines = [`## Deterministic checks — ${report.overall.toUpperCase()}`];
	for (const c of report.checks) {
		lines.push(`- ${c.name}: ${c.status.toUpperCase()} (${c.durationMs}ms)`);
	}
	return lines.join("\n") + "\n";
}
