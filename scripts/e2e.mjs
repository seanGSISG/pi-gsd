// End-to-end smoke test for pi-gsd.
//
// Exercises the full library pipeline against a temporary scratch repo:
//   plan parser → wave scheduler → git worktree → deterministic checks
//   → SessionMemory → dream gates + forced fire.
//
// No LLM round-trips, no interactive pi session required. If this script
// exits 0, pi-gsd's deterministic machinery is wired correctly.

import { execFile as execFileCb } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

import { emitPlan, parsePlan } from "../dist/plan/index.js";
import { schedulePlans } from "../dist/orchestrator/wave-scheduler.js";
import {
	createWorktree,
	removeWorktree,
	listWorktrees,
} from "../dist/orchestrator/worktree.js";
import { runDeterministicChecks } from "../dist/verification/deterministic.js";
import { appendSessionMemory } from "../dist/memory/session-memory.js";
import { runDream } from "../dist/memory/dream.js";
import { writeState, readState } from "../dist/memory/state.js";
import { ensureAgentsMd } from "../dist/memory/agents-md.js";

function step(name) {
	console.log(`\n▶ ${name}`);
}

const root = await mkdtemp(join(tmpdir(), "pi-gsd-e2e-"));
process.chdir(root);
console.log(`scratch repo: ${root}`);

// ── 1. git init + seed ────────────────────────────────────────────────
step("git init scratch repo");
await execFile("git", ["init", "-q", "-b", "main"], { cwd: root });
await execFile("git", ["config", "user.email", "e2e@pi-gsd"], { cwd: root });
await execFile("git", ["config", "user.name", "e2e"], { cwd: root });
await writeFile(
	resolve(root, "package.json"),
	`{"name":"pi-gsd-e2e","version":"0.0.0","scripts":{"test":"echo ok"}}\n`,
);
await writeFile(resolve(root, "README.md"), "# e2e scratch\n");
await execFile("git", ["add", "-A"], { cwd: root });
await execFile("git", ["commit", "-q", "-m", "seed"], { cwd: root });

// ── 2. scaffold .pi-gsd ───────────────────────────────────────────────
step("scaffold .pi-gsd via memory/state + agents-md modules");
await ensureAgentsMd(root, { projectName: "e2e", summary: "smoke test project" });
await writeState(root, {
	currentPhase: "01",
	currentPlan: null,
	status: "initialized",
	lastActivity: new Date().toISOString(),
	plansCompleted: 0,
	lastSummary: "seeded",
});
if (!existsSync(resolve(root, ".pi-gsd", "AGENTS.md"))) throw new Error("AGENTS.md not created");
if (!existsSync(resolve(root, ".pi-gsd", "STATE.md"))) throw new Error("STATE.md not created");
console.log("  AGENTS.md and STATE.md created");

// ── 3. author two PLAN.md files with a dependency and no file conflicts
step("author PLAN.md files");
const planDirA = resolve(root, ".pi-gsd", "phases", "01", "01-01");
const planDirB = resolve(root, ".pi-gsd", "phases", "01", "01-02");
await mkdir(planDirA, { recursive: true });
await mkdir(planDirB, { recursive: true });
const planA = {
	frontmatter: {
		phase: "01",
		plan: "01-01",
		depends_on: [],
		files_modified: ["src/a.js"],
		must_haves: [
			{
				id: "mh-1",
				kind: "artifact",
				statement: "src/a.js exists with a default export",
				risk: "normal",
			},
		],
	},
	objective: "Create src/a.js",
	context: "",
	tasks: [
		{
			id: "t1",
			name: "Write src/a.js",
			kind: "auto",
			files: ["src/a.js"],
			action: "Write `export default 'a';` to src/a.js.",
			verify: "grep -q 'export default' src/a.js",
			done: "file exists",
		},
	],
};
const planB = {
	...planA,
	frontmatter: {
		phase: "01",
		plan: "01-02",
		depends_on: ["01-01"],
		files_modified: ["src/b.js"],
		must_haves: [
			{
				id: "mh-2",
				kind: "artifact",
				statement: "src/b.js imports from a",
				risk: "normal",
			},
		],
	},
	objective: "Create src/b.js that imports from a.js",
	tasks: [
		{
			id: "t1",
			name: "Write src/b.js",
			kind: "auto",
			files: ["src/b.js"],
			action: "Write `import a from './a.js'; export default a;` to src/b.js.",
			verify: "grep -q 'from ./a.js' src/b.js",
			done: "file exists",
		},
	],
};
await writeFile(resolve(planDirA, "PLAN.md"), emitPlan(planA));
await writeFile(resolve(planDirB, "PLAN.md"), emitPlan(planB));
const reparsedA = parsePlan(readFileSync(resolve(planDirA, "PLAN.md"), "utf8"));
if (reparsedA.tasks.length !== 1) throw new Error("plan A round-trip failed");
console.log("  two PLAN.md files written and parsed back successfully");

// ── 4. wave scheduler ─────────────────────────────────────────────────
step("wave scheduler");
const schedule = schedulePlans([
	{
		plan: planA.frontmatter.plan,
		depends_on: planA.frontmatter.depends_on,
		files_modified: planA.frontmatter.files_modified,
	},
	{
		plan: planB.frontmatter.plan,
		depends_on: planB.frontmatter.depends_on,
		files_modified: planB.frontmatter.files_modified,
	},
]);
if (schedule.waves.length !== 2) {
	throw new Error(`expected 2 waves, got ${schedule.waves.length}`);
}
if (schedule.waves[0].plans[0] !== "01-01") throw new Error("wrong wave-1 plan");
if (schedule.waves[1].plans[0] !== "01-02") throw new Error("wrong wave-2 plan");
if (schedule.waves.some((w) => w.conflicts.length > 0)) {
	throw new Error("scheduler flagged spurious conflicts");
}
console.log(`  ${schedule.waves.length} waves, zero conflicts, order ${JSON.stringify(schedule.order)}`);

// ── 5. worktree create + remove ───────────────────────────────────────
step("git worktree create/remove");
const wtPath = resolve(root, ".pi-gsd", "worktrees", "01-01");
const handle = await createWorktree(root, wtPath, "pi-gsd/e2e-01-01");
if (!existsSync(handle.path)) throw new Error("worktree dir not created");
const wts = await listWorktrees(root);
if (!wts.some((w) => w.branch === "pi-gsd/e2e-01-01")) {
	throw new Error("listWorktrees did not see the new worktree");
}
console.log(`  created ${handle.path} on branch ${handle.branch}`);
await removeWorktree(root, handle);
const wtsAfter = await listWorktrees(root);
if (wtsAfter.some((w) => w.branch === "pi-gsd/e2e-01-01")) {
	throw new Error("worktree not removed");
}
console.log("  worktree removed cleanly");

// ── 6. deterministic checks ───────────────────────────────────────────
step("deterministic verification (npm test only)");
const report = await runDeterministicChecks(root);
if (report.overall !== "pass") {
	throw new Error(`deterministic checks did not pass: ${JSON.stringify(report)}`);
}
console.log(`  overall: ${report.overall}, checks: ${report.checks.map((c) => `${c.name}:${c.status}`).join(" ")}`);

// ── 7. SessionMemory + dream loop ─────────────────────────────────────
step("SessionMemory append + forced dream");
for (let i = 0; i < 3; i++) {
	await appendSessionMemory(root, {
		source: `phase-01/smoke-${i}`,
		body: `sample entry ${i}`,
		timestamp: new Date(Date.now() - i * 24 * 3_600_000),
	});
}
const dream = await runDream({ projectRoot: root, force: true });
if (!dream.fired) throw new Error(`dream did not fire: ${JSON.stringify(dream)}`);
if (!existsSync(dream.promptPath)) throw new Error("dream prompt file missing");
const promptBody = readFileSync(dream.promptPath, "utf8");
if (!promptBody.includes("Dream: Memory Consolidation"))
	throw new Error("dream prompt content unexpected");
console.log(`  dream fired, prompt at ${dream.promptPath}`);

// ── 8. dream-log observability line + lock stamp ──────────────────────
const dreamLog = resolve(root, ".pi-gsd", "memory", ".dream.log");
if (!existsSync(dreamLog)) throw new Error("dream observability log missing");
const line = JSON.parse(readFileSync(dreamLog, "utf8").trim().split("\n").pop());
if (line.event !== "dream_fired") throw new Error("dream_fired event not logged");
console.log(`  observability: ${JSON.stringify(line)}`);

// ── 9. state round-trip sanity ────────────────────────────────────────
step("state round-trip");
const finalState = readState(root);
if (finalState.currentPhase !== "01") throw new Error("state lost currentPhase");

// ── cleanup ───────────────────────────────────────────────────────────
await rm(root, { recursive: true, force: true });
console.log("\n✅ E2E smoke PASS");
