# pi-gsd

A modern agentic workflow engine for the [pi coding CLI](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent), inspired by [get-shit-done](https://github.com/gsd-build/get-shit-done) but redesigned for 2025-era agent tooling.

Ships as a pi extension — `pi install git:github.com/seanGSISG/pi-gsd` and you get a full phase-based workflow (`/gsd-plan`, `/gsd-execute`, `/gsd-verify`, `/gsd-ship`) with parallel git-worktree executors, deterministic hook-enforced guardrails, and a background memory-consolidation dream loop.

> **Status**: v0.1 — the entire deterministic pipeline (plan parsing, wave scheduling, worktrees, deterministic verification, session memory, dream gates) is complete and exercised by an E2E smoke test. LLM-driven steps (planner, executor, verifier) currently render prompt artefacts that you feed to the main pi session; direct in-process sub-agent transport is the v1.1 upgrade.

## Install

```bash
# From a clone (development):
npm install
npm run build
pi install /path/to/pi-gsd -l   # -l = install into the current project only

# From a GitHub remote:
pi install git:github.com/seanGSISG/pi-gsd
```

After install, `pi` will pick up 11 `/gsd-*` commands on next launch.

## Commands

| Command | Purpose |
|---|---|
| `/gsd-hello` | Smoke test — confirms the extension loads |
| `/gsd-init` | Scaffold `.pi-gsd/` with PROJECT.md, AGENTS.md, ROADMAP.md, STATE.md |
| `/gsd-discuss <phase>` | Capture goal + constraints + open questions → `phases/<phase>/CONTEXT.md` |
| `/gsd-plan <phase>` | Render the planner prompt or validate an existing PLAN.md |
| `/gsd-execute <phase>` | Schedule plans into dependency waves, create one git worktree per plan, render executor prompts |
| `/gsd-verify <phase>` | Run deterministic checks (test/lint/typecheck) + render verifier prompt → VERIFICATION.md |
| `/gsd-ship` | Assemble PR body from latest SUMMARY/VERIFICATION, optionally `gh pr create` |
| `/gsd-status` | Dashboard of STATE.md, discovered phases, active pi-gsd worktrees |
| `/gsd-resume` | Read the newest `.resume.json` and cross-check its worktrees |
| `/gsd-dream [--force]` | Run the memory-consolidation dream (bypasses time+session gates with `--force`) |
| `/gsd-memory` | View `memory/MEMORY.md`, list topic files, show last-dream timestamp |

## Workflow

```
/gsd-init
  ↓ edit .pi-gsd/ROADMAP.md with phase names
/gsd-discuss 01       → phases/01/CONTEXT.md
  ↓
/gsd-plan 01          → phases/01/planner.prompt.md
  ↓ paste into pi main session, save reply as PLAN.md
/gsd-plan 01          → validates PLAN.md
  ↓
/gsd-execute 01       → schedules into waves, creates worktrees, writes executor.prompt.md per plan
  ↓ feed each executor prompt to pi, let it commit atomically inside its worktree
/gsd-verify 01        → deterministic layer runs; verifier.prompt.md is written
  ↓
/gsd-ship             → last-pr.md + gh pr create
```

## Architecture

```
src/
├── extension.ts           Registers commands + tool_call safety hook + session_shutdown memory hook
├── commands/              Slash-command entry points (one file each)
├── orchestrator/
│   ├── subagent.ts        Prompt-rendering helper (loadRolePrompt + renderSubagentPrompt)
│   ├── wave-scheduler.ts  Kahn topological sort + wave grouping + intra-wave file-conflict detection
│   └── worktree.ts        git worktree add/remove/merge/list helpers
├── plan/
│   ├── schema.ts          TypeBox Plan / Task / MustHave / Frontmatter
│   ├── parser.ts          YAML frontmatter + ```task fenced JSON blocks
│   └── emitter.ts         Round-trip-stable Markdown serializer
├── verification/
│   └── deterministic.ts   runDeterministicChecks (auto-detects npm test/lint/typecheck)
├── hooks/
│   ├── pre-tool-guard.ts  inspectBashCommand (rm -rf/-fr, mkfs, fork bomb, etc) + inspectWritePath
│   ├── injection-scan.ts  Only scans writes into .pi-gsd/; catches jailbreak phrases, hidden tags, invisible unicode
│   └── index.ts           Wires the above into pi.on("tool_call") with ToolCallEventResult.block semantics
└── memory/
    ├── state.ts           .pi-gsd/STATE.md atomic writer with .backup sibling
    ├── agents-md.ts       .pi-gsd/AGENTS.md seeder + append helpers
    ├── session-memory.ts  Tier 1: append-only logs/YYYY/MM/YYYY-MM-DD.md
    ├── dream-lock.ts      PID + mtime file lock with 60-min stale guard (ported from claude-code)
    ├── dream-prompt.ts    4-phase reflective-pass prompt (Orient → Gather → Consolidate → Prune/Index)
    └── dream.ts           Tier 2: gate sequence (time → scan throttle → session → lock), fires the prompt

agents/                    Role prompts loaded by renderSubagentPrompt
├── planner.md
├── plan-checker.md
├── executor.md
└── verifier.md
```

### Data layout (`.pi-gsd/`)

```
.pi-gsd/
├── PROJECT.md                 Vision + constraints
├── AGENTS.md                  Living human-editable project memory
├── ROADMAP.md                 Phase list with success criteria
├── STATE.md                   Current position (short, ephemeral)
├── config.json                Workflow toggles (dream thresholds etc)
├── memory/
│   ├── MEMORY.md              Index, <200 lines, <25KB — auto-loaded context
│   ├── <topic>.md             Consolidated memories (4 frontmatter types)
│   ├── logs/YYYY/MM/YYYY-MM-DD.md   SessionMemory daily stream
│   ├── .dream-lock            PID + mtime — Tier 2 cooldown and mutex
│   └── .dream.log             JSONL observability line per dream fire
└── phases/NN-name/
    ├── CONTEXT.md             From /gsd-discuss
    ├── RESEARCH.md            Optional
    ├── planner.prompt.md      From /gsd-plan
    ├── PLAN.md                The plan body — YAML frontmatter + fenced task JSON
    ├── <plan>.executor.prompt.md  One per plan, from /gsd-execute
    ├── <plan>-SUMMARY.md      Executor output
    ├── verifier.prompt.md     From /gsd-verify
    ├── VERIFICATION.md        Must-have verdicts + deterministic report
    └── .resume.json           Restart state for /gsd-resume
```

## Key design departures from GSD

1. **Hybrid plan format** — Markdown + YAML frontmatter + `'''task` fenced JSON, not XML. Smaller context footprint, better for future [CodeAct](https://arxiv.org/abs/2402.01030)-style upgrades.
2. **Hooks do the safety work, not prompts** — `tool_call` event blocking via pi's extension API, so guardrails hold even if a planner or executor is prompt-injected.
3. **DAG + dynamic waves** — `depends_on` is per-plan, `wave` is computed, not hand-assigned. Re-planning is cheap.
4. **Devin's "don't build multi-agents" principle** — we only spawn sub-agents for parallel-safe work (disjoint `files_modified`). Overlap is detected pre-flight and forces sequential execution.
5. **Two-tier memory with a dream loop** — SessionMemory (hot, cheap, append-only daily logs) + Dream (cold, reflective, gated consolidation pass) directly ported from the leaked [claude-code autoDream service](https://github.com/yasasbanukaofficial/claude-code/tree/main/src/services/autoDream). GSD has zero cross-session semantic memory; pi-gsd has an auto-maintained `MEMORY.md` playbook.
6. **3-layer verification** — deterministic checks first (free), LLM self-check second, ensemble judges only for high-risk must-haves. Scaffolded; v1 implements layer 1 end-to-end and renders prompts for 2+3.

## Tests

```bash
npm test            # 44 unit tests, ~300ms
node scripts/smoke.mjs   # runtime check: extension loads in real pi resource loader
node scripts/e2e.mjs     # full pipeline on a scratch git repo
```

The E2E script:

1. Creates a temp git repo
2. Scaffolds `.pi-gsd/`
3. Writes two PLAN.md files with a dependency
4. Runs the wave scheduler (expects 2 waves, 0 conflicts)
5. Creates + lists + removes a git worktree
6. Runs deterministic checks against `npm test`
7. Appends SessionMemory entries across different days
8. Forces a dream pass — verifies prompt file, observability log, state persistence

## Known limitations (v1)

- **Planner / executor / verifier run out-of-process** via rendered prompt artefacts. v1.1 will wire `@mariozechner/pi-agent-core`'s `Agent` class for in-process fresh-context sub-agents (blueprint already in `src/orchestrator/subagent.ts`).
- **KAIROS "always-on" mode is deferred.** v1 implements only the gated forked-agent dream path; KAIROS lives behind a feature flag in v1.1.
- **No MCP integration in v1.** Pi's built-in tools cover everything; MCP can be added as an extension.
- **Single-model config.** `/gsd-set-profile` for model switching is out of scope for v1.

## Reference sources

- [badlogic/pi-mono](https://github.com/badlogic/pi-mono) — the pi coding CLI this extends
- [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done) — the workflow engine whose spine we adopted
- [yasasbanukaofficial/claude-code](https://github.com/yasasbanukaofficial/claude-code/tree/main/src/services/autoDream) — the leaked autoDream implementation we ported directly
- [ultraworkers/claw-code](https://github.com/ultraworkers/claw-code) — cross-reference for multi-agent orchestration patterns
- [Anthropic: Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic: How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Cognition: Don't build multi-agents](https://cognition.ai/blog/dont-build-multi-agents)
- [CodeAct (ICML 2024)](https://arxiv.org/abs/2402.01030)

## License

MIT
