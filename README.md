# pi-gsd

**An opinionated, phase-based workflow for the [pi coding CLI](https://github.com/badlogic/pi-mono).**

Break big work into small phases. Plan each phase with a sub-agent. Execute plans in parallel inside isolated git worktrees. Verify against concrete must-haves. Remember what you learned between sessions.

pi is deliberately minimal — four tools (read, write, edit, bash) and an extension API. pi-gsd adds the layer above: **discuss → plan → execute → verify → ship**, with deterministic safety rails and a background memory-consolidation "dream" loop.

Inspired by [get-shit-done](https://github.com/gsd-build/get-shit-done), redesigned from scratch with ideas from Anthropic's multi-agent research system, Cognition's "don't build multi-agents" principle, CodeAct, and the leaked Claude Code autoDream service.

---

## Why use it

Coding agents are great at small tasks and fall over on big ones. The usual failure modes:

- **Context rot.** The conversation fills up with stale reasoning and the model starts contradicting itself.
- **Silent scope reduction.** You ask for X, Y, Z and get X and a half.
- **No memory across sessions.** Every new chat starts cold.
- **One slow thread.** Even when tasks are independent, the agent does them serially.
- **"Trust me, it works."** No real verification; bugs slip in because nobody checked.

pi-gsd tries to fix each one:

| Problem | pi-gsd answer |
|---|---|
| Context rot | Every sub-agent gets a fresh 200k context and only the files it needs |
| Scope reduction | Every requirement becomes a `must_have` the verifier checks against reality |
| Cold starts | A two-tier memory system (daily logs + reflective "dream" consolidation) that auto-loads into every sub-agent |
| Serial work | Wave-based parallel executors in isolated git worktrees |
| Unverified work | Three verification layers: deterministic (tests/lint/types) → LLM self-check → ensemble judges |

---

## Install

```bash
# One-liner (when the repo is public):
pi install git:github.com/seanGSISG/pi-gsd

# Or from a local clone:
git clone https://github.com/seanGSISG/pi-gsd
cd pi-gsd
npm install
npm run build
pi install . -l            # -l = install into this project only
```

Then launch pi in any git repo and type `/gsd-hello`. If you see `pi-gsd v0.1.0 loaded`, you're good.

> **Requirements:** Node.js 20+, git, and [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) 0.66+.

---

## Quick start — your first phase

Inside any git repo:

```bash
pi                                    # launch pi
/gsd-init                             # answer 3 questions, scaffolds .pi-gsd/
```

Edit `.pi-gsd/ROADMAP.md` and list the phases you want, one per line. Then:

```bash
/gsd-discuss 01                       # capture goal + constraints for phase 01
/gsd-plan 01                          # render a planner prompt
```

pi-gsd writes a `planner.prompt.md` file. Paste it to pi, save pi's reply as `PLAN.md`, then:

```bash
/gsd-plan 01                          # now validates the saved PLAN.md
/gsd-execute 01                       # schedules plans into waves, makes git worktrees, writes executor prompts
```

Feed each executor prompt to pi (one per plan). When they're all done:

```bash
/gsd-verify 01                        # runs your tests, lint, typecheck; writes VERIFICATION.md
/gsd-ship                             # assembles a PR body and optionally runs `gh pr create`
```

And between sessions, the dream loop quietly consolidates what you learned:

```bash
/gsd-dream                            # runs only if enough time + session activity has accumulated
/gsd-dream --force                    # run now regardless
/gsd-memory                           # peek at what's been consolidated
```

---

## All commands

| Command | What it does |
|---|---|
| `/gsd-hello` | Smoke test — confirms pi-gsd is loaded |
| `/gsd-init` | Scaffold `.pi-gsd/` with PROJECT.md, AGENTS.md, ROADMAP.md, STATE.md |
| `/gsd-discuss <phase>` | Capture goal, constraints, and open questions for a phase |
| `/gsd-plan <phase>` | Render the planner prompt, or validate an existing PLAN.md |
| `/gsd-execute <phase>` | Schedule plans into dependency waves, create worktrees, render executor prompts |
| `/gsd-verify <phase>` | Run tests/lint/typecheck, write VERIFICATION.md, render verifier prompt |
| `/gsd-ship` | Build a PR body from latest SUMMARY/VERIFICATION and (optionally) `gh pr create` |
| `/gsd-status` | Dashboard: current phase, plans done, active worktrees |
| `/gsd-resume` | Resume a paused execution from `.resume.json` |
| `/gsd-dream [--force]` | Background memory consolidation pass |
| `/gsd-memory` | View the consolidated memory index and topic files |

---

## How it thinks

### Phases → plans → atomic tasks

A **phase** is a chunk of work big enough to matter, small enough to finish (e.g. "add email notifications"). Phases are composed of one or more **plans**, each of which is a set of **atomic tasks**. Every task is one commit.

A `PLAN.md` looks like:

```yaml
---
phase: "03"
plan: "03-01"
depends_on: []
files_modified:
  - src/email/client.ts
must_haves:
  - id: mh-1
    kind: artifact
    statement: "src/email/client.ts exports sendEmail"
    risk: normal
---

# Objective

Build a SendGrid wrapper module.

## Tasks

```
{
  "id": "t1",
  "name": "Create email client",
  "files": ["src/email/client.ts"],
  "action": "Write a module exporting sendEmail(to, template, data) that wraps the SendGrid SDK with retry + logging.",
  "verify": "grep -q 'export function sendEmail' src/email/client.ts",
  "done": "client.ts exists and exports sendEmail"
}
```
```

### Waves: parallelism without mayhem

When you `/gsd-execute` a phase, pi-gsd reads every PLAN.md and builds a dependency graph:

```
wave 1:  01-01 (schema)     01-02 (logger)
              ↓                     ↓
wave 2:  01-03 (api)   ← both depend on schema+logger
              ↓
wave 3:  01-04 (ui)   ← depends on api
```

Plans inside the same wave run **in parallel**, each in its own `git worktree` so file writes can't collide. If two plans in the same wave touch the same file, pi-gsd catches it before execution and makes you split or sequence them.

### Three-layer verification

After execution, `/gsd-verify` runs these in order:

1. **Deterministic layer** — your real tests, lint, typecheck. Fast and cheap. Runs every time.
2. **LLM self-check** — an agent reads your PLAN.md must-haves and the actual code, and marks each one pass/fail against reality, not against what the executor claimed.
3. **Ensemble judges** (only for must-haves tagged `risk: high`) — three lightweight judges with different rubrics (correctness / security / style) vote.

Fails flow back into a revision loop. There's no "trust me."

### Deterministic safety hooks

pi-gsd registers a blocking `tool_call` hook that catches, before any destructive action reaches pi:

- `rm -rf`, `rm -fr`, `mkfs`, fork bombs, `shutdown`, `dd if=/dev/zero of=/dev/sda`…
- Writes outside the project root
- Writes to `.env*`, `.ssh/`, `.aws/`, SSH private keys
- Prompt-injection patterns in writes to `.pi-gsd/` (hidden `<system>` tags, jailbreak phrases, zero-width unicode)

These are **deterministic**, not prompt-based, so they hold even if a planner or executor is prompt-injected.

### Memory that survives sessions

Two tiers, both stored under `.pi-gsd/memory/`:

- **Tier 1 — SessionMemory.** An append-only daily log at `memory/logs/YYYY/MM/YYYY-MM-DD.md`. Phase completions and session shutdowns drip state snapshots here. Cheap, no LLM involved.
- **Tier 2 — Dream.** A reflective consolidation pass that reads the daily logs and the phase summaries, then updates `memory/MEMORY.md` (an index) and topic files (`design-patterns.md`, `build-system.md`, etc). Gated by three things: ≥8 hours since last dream, ≥3 log files touched since, and a PID+mtime file lock so two pi sessions can't dream at once.

Directly ported from the [Claude Code autoDream service](https://github.com/yasasbanukaofficial/claude-code/tree/main/src/services/autoDream), adapted for pi-gsd's phase vocabulary.

---

## What gets written to your project

```
.pi-gsd/
├── PROJECT.md            # Vision + constraints
├── AGENTS.md             # Living project memory (edit by hand)
├── ROADMAP.md            # Phase list with success criteria
├── STATE.md              # Current position (where am I in the flow)
├── memory/
│   ├── MEMORY.md         # Auto-maintained index of long-term memories
│   ├── *.md              # Topic files consolidated by the dream loop
│   ├── logs/             # Append-only daily session logs
│   └── .dream-lock       # PID + mtime — cooldown and mutex
└── phases/
    └── 01-email/
        ├── CONTEXT.md    # From /gsd-discuss
        ├── PLAN.md       # Generated, validated by /gsd-plan
        ├── 01-01-SUMMARY.md   # After /gsd-execute
        ├── VERIFICATION.md    # After /gsd-verify
        └── .resume.json  # For /gsd-resume if interrupted
```

Nothing pi-gsd touches lives outside `.pi-gsd/` except the actual code you asked the executor to write.

---

## Current status (v0.1)

The entire **deterministic pipeline** — plan parsing, wave scheduling, git worktrees, deterministic verification, session memory, dream gates — is done and exercised by an E2E smoke test.

The **LLM-driven steps** — planner, executor, verifier — currently render prompt artefacts you paste into the main pi session. Upgrading them to in-process sub-agents (using `@mariozechner/pi-agent-core`'s `Agent` class) is the v1.1 change. The interfaces are already shaped for it — `src/orchestrator/subagent.ts`.

### What works today

- ✅ 11 slash commands registered and verified in a real pi resource loader
- ✅ 44 unit tests (plan parser, wave scheduler, hooks, state, dream lock, dream gates)
- ✅ End-to-end pipeline on a scratch git repo: scaffold → plan round-trip → wave schedule → worktree create/remove → deterministic checks → SessionMemory → dream fire → observability log
- ✅ Deterministic safety hooks blocking real destructive patterns
- ✅ Full two-tier memory system with gated consolidation

### Known v1 limitations

- Planner / executor / verifier are prompt-artefact based (paste-into-pi-session pattern). In-process sub-agents land in v1.1.
- KAIROS-style always-on background mode is deferred.
- No MCP integration in v1 — pi's built-in tools cover the workflow.
- Single model profile — no `/gsd-set-profile` yet.

---

## Development

```bash
git clone https://github.com/seanGSISG/pi-gsd
cd pi-gsd
npm install
npm run build
npm test                               # 44 unit tests, ~300ms
node scripts/smoke.mjs                 # runtime extension load check
node scripts/e2e.mjs                   # full pipeline on a scratch git repo
```

Project layout:

```
src/
├── extension.ts               # pi entry point
├── commands/                  # one file per slash command
├── orchestrator/              # subagent, wave-scheduler, worktree
├── plan/                      # TypeBox schema + parser + emitter
├── verification/              # deterministic checks
├── hooks/                     # pre-tool guards + injection scanner
└── memory/                    # state, agents-md, session-memory, dream*
agents/                        # role prompts (planner, executor, verifier, checker)
test/                          # vitest suites
scripts/                       # smoke.mjs + e2e.mjs
```

---

## References

- [pi-mono](https://github.com/badlogic/pi-mono) — the coding CLI this extends
- [get-shit-done](https://github.com/gsd-build/get-shit-done) — the workflow engine whose spine we adopted
- [Claude Code autoDream](https://github.com/yasasbanukaofficial/claude-code/tree/main/src/services/autoDream) — directly ported for Phase 9
- [Anthropic: Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic: How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Cognition: Don't build multi-agents](https://cognition.ai/blog/dont-build-multi-agents)
- [CodeAct (ICML 2024)](https://arxiv.org/abs/2402.01030)

---

## License

MIT
