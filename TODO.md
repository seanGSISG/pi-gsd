# pi-gsd TODO

Living backlog. Roughly ordered by impact × feasibility. Cross off as we ship.

---

## 🔥 Next up — finish what v1 started

The deterministic layer is done and tested. These items close the gap between "prompt artefact you paste into pi" and "actually runs end-to-end."

### 1. In-process sub-agents via `@mariozechner/pi-agent-core`

**Why:** Every LLM-driven step (planner, plan-checker, executor, verifier, judges, dream) currently renders a `*.prompt.md` and waits for the user to paste it into the main pi session. That pattern shipped v1 fast but it's not the end state.

**Scope:**
- `src/orchestrator/subagent.ts` already has `renderSubagentPrompt` (pure) and `loadRolePrompt`. Add `runSubagent({ role, context, model })` that:
  - Constructs a fresh `Agent` from `@mariozechner/pi-agent-core`
  - Attaches read/grep/glob (and for executor: write/edit/bash) tools — reuse `createReadToolDefinition`, `createBashToolDefinition`, etc. from `@mariozechner/pi-coding-agent`
  - Runs the agent to completion via `agent.prompt(...)` + `agent.waitForIdle()`
  - Collects the final assistant message
  - Returns `{ text, toolCalls, tokens }`
- Respect `.pi-gsd/config.json` for model pattern and thinking budget.
- Swap every `*.prompt.md` writer in `commands/plan.ts`, `execute.ts`, `verify.ts`, `dream.ts` to call `runSubagent` directly.

**Tests:** add a faux provider-based integration test using `@mariozechner/pi-ai`'s `faux` provider to drive a canned conversation through `runSubagent`.

**Blocker:** none — the pi-agent-core API is already on disk in `node_modules`.

---

### 2. Planner ↔ checker revision loop

**Why:** The planner role prompt exists and plan-checker exists, but nothing actually loops them. GSD's key quality gate is "plan-checker rejects → planner revises (max 3) → escalate."

**Scope:**
- `src/commands/plan.ts`: after running the planner sub-agent, parse its output, then run the plan-checker sub-agent.
- If checker returns `{verdict: "pass"}` → write PLAN.md.
- If `{verdict: "revise"}` → re-run planner with checker feedback appended; cap at 3 iterations.
- If still failing after 3 → write the partial PLAN.md + the checker's issues list as `PLAN.md.draft` and a clear escalation message.
- Detect stalls: if issue count doesn't strictly decrease between iterations, escalate immediately.

**Tests:**
- `test/plan-revision.test.ts` using the faux provider and canned checker responses: pass, revise→pass, revise→revise→revise→escalate, stall detection.

---

### 3. Wave executor that actually runs inside the worktrees

**Why:** `/gsd-execute` today creates the worktrees and writes executor prompts. v1.1 should actually fan out — `Promise.all` across plans in a wave, each running a `runSubagent("executor", ...)` with cwd pinned to its worktree.

**Scope:**
- `src/orchestrator/execute-wave.ts` (new): takes a `Wave` + plan list + worktree handles, launches them concurrently, collects results, writes each `<plan>-SUMMARY.md`.
- Atomic-commit discipline: the executor prompt already specifies "one commit per task, clean messages" but we should enforce it by running `git log --oneline` in the worktree after and rejecting if no commits were made.
- After all plans in a wave succeed, merge each worktree sequentially with `mergeWorktree` (ff-only). If any merge fails, halt the wave and surface the conflict — do not silently continue.
- If any plan fails, abort the wave, leave the worktrees in place, update `.resume.json`, and print a recovery hint.
- Respect the `/gsd-resume` contract: every partial state must be resumable.

**Tests:**
- Faux-provider-driven integration test with a two-plan phase, disjoint files, succeeds and merges clean.
- Same phase with one plan simulated to fail — wave aborts, worktrees preserved, resume state correct.

---

### 4. Verification layer 2 + layer 3

**Why:** `/gsd-verify` runs the deterministic layer (tests/lint/typecheck) but the must-have checking (layer 2) and ensemble judges (layer 3) are just rendered prompts.

**Scope:**
- **Layer 2:** `src/verification/llm-check.ts`. One verifier sub-agent per phase, reads PLAN.md + actual code, emits a JSON verdict for each must-have (`{id, status: "pass"|"fail"|"unknown", evidence}`), merged into VERIFICATION.md.
- **Layer 3:** `src/verification/ensemble.ts`. Only runs for must-haves tagged `risk: high`. Spawns 3 judges (correctness / security / style) with different role prompts, aggregates via majority + surfaces disagreement.
- Re-verification mode: if VERIFICATION.md already exists, only re-check previously-failing items.

**Tests:** faux-provider-driven; assert JSON parsing and merge logic.

---

### 5. /gsd-resume actually resumes

Today `/gsd-resume` reads `.resume.json` and prints. Upgrade to:
- Cross-check worktrees against `git worktree list`
- Detect partially-completed waves (which plans committed, which didn't)
- Re-run only the failed plans via the new wave executor
- Clean up stale worktrees from crashed runs

---

## 🧭 v1.1 roadmap

### Dream loop: actually run the dream pass

Today `/gsd-dream` renders the consolidation prompt and stamps the lock. v1.1 should:
- Run the dream pass in-process via `runSubagent("dream", { tools: readOnly })` where `readOnly` is a restricted tool set (read, grep, glob, ls, **no bash**, write/edit scoped to `.pi-gsd/memory/`).
- Verify the dream actually updated MEMORY.md before stamping the lock — if not, rollback via `rollbackDreamLock`.
- Auto-fire on `session_start` (not just `session_shutdown`) — matches claude-code's trigger point, avoids blocking shutdown.

### KAIROS "always-on" mode

Optional background mode where pi-gsd proactively fires dreams without waiting for the gate. Behind a feature flag in `.pi-gsd/config.json`. Requires a long-lived background timer and careful coordination with the main pi session. Mirror the `getKairosActive()` disable-autoDream branch from the reference implementation.

### Model profiles

`/gsd-set-profile quality|balanced|budget|inherit` writing to `.pi-gsd/config.json`. Sub-agents pick their model per role (planner=quality, executor=balanced, judges=budget). Load on every `runSubagent` call.

### Skills + prompts shipped as package resources

Declared in `package.json` `"pi": { "skills": ["./skills"], "prompts": ["./prompts"] }` but both directories are empty. Populate:
- `skills/plan-phase/SKILL.md` — condensed "how to use pi-gsd" trigger guide
- `skills/execute-phase/SKILL.md`
- `skills/verify-phase/SKILL.md`
- `prompts/phase-discuss.md` — reusable discussion template
- `prompts/phase-summary.md` — summary template executors can crib from

### More commands from GSD that are worth porting

Not full parity — just the high-leverage ones:
- `/gsd-debug` — systematic debugging with a persistent DEBUG.md
- `/gsd-code-review` — run the existing pi code reviewer as a sub-agent
- `/gsd-scan` — quick codebase assessment (wraps Glob/Grep into a single-shot report)
- `/gsd-add-todo` + `/gsd-check-todos` — ephemeral todo parking lot
- `/gsd-thread` — cross-session persistent context threads

---

## 🔬 Research spikes

Short timeboxed investigations before we commit to changes.

### CodeAct upgrade for task action format

**Hypothesis:** replacing the prose `action` field in `task` blocks with executable TypeScript/bash snippets would eliminate a layer of LLM-to-action translation error.

**Spike:**
- Build a prototype `TaskKind: "codeact"` where `action` is a code block
- Executor directly exec's it instead of re-interpreting
- Measure: does verify pass more often? Do fewer tasks deviate?
- Reference: [CodeAct ICML 2024](https://arxiv.org/abs/2402.01030), Hugging Face [smolagents](https://huggingface.co/blog/smolagents)

**Effort:** ~1-2 days spike, ~3-5 days full port if it wins.

### Speculative execution for deterministic sub-steps

**Hypothesis:** while the executor is waiting for a slow test run, we could speculatively stage the next task's edits. If the test passes, we save wall time; if it fails, we roll back the speculation at zero correctness cost.

**Spike:**
- Pick a phase with long tests (our own test suite on a CI-loaded machine)
- Instrument one wave execution with speculative next-task staging
- Measure wall time saved vs tokens wasted on rollbacks
- References: [Sherlock (2025)](https://arxiv.org/pdf/2511.00330), [Speculative Actions (2025)](https://arxiv.org/pdf/2510.04371)

**Decision criterion:** only worth shipping if ≥20% wall-time reduction on multi-wave phases.

### Does the plan-checker actually catch the failures the planner makes?

**Hypothesis:** the plan-checker's value is in its recall — it should catch the plans that would fail verification. But that's just a hypothesis until measured.

**Spike:**
- Build a small corpus of 10-20 "bad plans" (known scope drops, missing tasks, broken deps) by hand
- Run the plan-checker on each with different model tiers
- Measure recall (did it flag the issue?) and precision (did it flag false positives?)
- If recall is <70%, rewrite the checker prompt or add deterministic pre-checks

### Claw-code multi-agent orchestration patterns

**Why:** we cloned `ultraworkers/claw-code` during Phase 9 but only skimmed it. Their OmO (Architect/Executor/Reviewer) three-role model is worth studying — does their role separation reduce context contamination vs our current planner/executor/verifier?

**Spike:**
- Read `rust/runtime` and the role definitions
- Compare their message-passing protocol to our prompt-rendering approach
- Note any patterns worth borrowing

### MemGPT / Letta-style sleep-time compute

**Why:** the dream loop is claude-code's version. Letta's separates sleep-time agent entirely from the primary agent with a different model tier. Worth comparing.

**Spike:**
- Read Letta's blog + their open-source implementation
- Question: should our dream pass use a *different* model from the main session (e.g. Opus for dream, Sonnet for main)?
- Cost/benefit tradeoff vs the "same model in a fork" approach we inherited

---

## 🧹 Cleanup / paper cuts

Small stuff that'll annoy the next maintainer (me, probably) if we don't.

- [ ] `src/memory/session-memory.ts` uses `require("node:fs")` inside `listSessionLogs`. Should be a top-level ESM import. Low priority (works in tsc's emitted output) but ugly.
- [ ] `test/state.test.ts` has no cleanup of temp dirs on failure — every failed run leaks a `/tmp/pigsd-state-*` directory. Add `afterEach(() => rm(root, { recursive: true, force: true }))`.
- [ ] The `hooks/index.ts` `registerHooks` function has no test for the `pi.on("tool_call", ...)` wiring itself — only the pure inspection functions. Add a mock `ExtensionAPI` in tests.
- [ ] `/gsd-status` doesn't distinguish "no phases yet" from "no .pi-gsd/ at all". Clearer error when uninitialized.
- [ ] `/gsd-plan` validate path prints task count but not plan id. Include plan id and wave number.
- [ ] The `hello.ts` version string is hardcoded. Import from `package.json` via a tsconfig `resolveJsonModule` read.
- [ ] Add a `.editorconfig` so contributors get consistent tab/space behavior.
- [ ] Expand `scripts/smoke.mjs` to also exercise `registerHooks` dispatch using a mock ExtensionAPI.
- [ ] Add a vitest coverage report target + threshold in CI once we have CI.
- [ ] Biome or Prettier config — right now there's no formatter.
- [ ] Add CI (GitHub Actions): lint + test + build on push to `main` and PRs. Matrix Node 20 + 22.

---

## 🔐 Security hardening

- [ ] Lock file for STATE.md writes — two pi sessions writing STATE.md concurrently would currently race. Use the same PID+mtime pattern as dream-lock.
- [ ] Expand `inspectBashCommand` with tested patterns for: `curl ... | sh`, `wget ... | sh`, `base64 -d | sh`, python/node inline code execution of untrusted strings.
- [ ] Secret scanner before writes into `.pi-gsd/` — if the model tries to paste a token, API key, or SSH private key into a PLAN.md or CONTEXT.md, reject.
- [ ] Review the injection-scan pattern set against [OWASP LLM Prompt Injection Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html). Current set covers ~80%.
- [ ] `inspectWritePath` currently normalizes via `node:path` but doesn't resolve symlinks. A symlink from `.pi-gsd/tmp/escape` → `/etc/passwd` would bypass. Add `realpath` on the target dir.

---

## 📦 Packaging

- [ ] Publish to npm as `@seangsisg/pi-gsd` (scope config, 2FA, prepublishOnly build hook)
- [ ] Add a `bin` field so `npx @seangsisg/pi-gsd init` could scaffold `.pi-gsd/` *without* needing a live pi session (useful for CI)
- [ ] Version bump policy: v0.x → v1.0 when planner/executor/verifier run in-process (items 1–4 above)
- [ ] CHANGELOG.md following Keep a Changelog format
- [ ] Add a MIT LICENSE file (README says MIT but no LICENSE file is committed)

---

## 📚 Documentation

- [ ] `docs/architecture.md` — the big picture diagram, flow diagrams for plan→execute→verify→ship, the dream loop state machine
- [ ] `docs/writing-phases.md` — concrete examples of good phases + bad phases, rules of thumb
- [ ] `docs/memory-model.md` — explain AGENTS.md vs STATE.md vs memory/ vs the four memory types, with when-to-use guidance
- [ ] `docs/hook-reference.md` — every blocking pattern with one-sentence rationale, so security reviewers can audit fast
- [ ] `docs/configuration.md` — everything that lives in `.pi-gsd/config.json` (dream gates, model profile, workflow toggles)
- [ ] Example repo: clone this and it's already a pi-gsd-managed project showing a realistic 5-phase build
- [ ] A short screencast / asciinema demo of the full loop

---

## ❓ Open questions

No right answer yet — these need a decision before implementation.

1. **Should the dream loop run inside a git worktree?** Pros: truly sandboxed writes. Cons: memory dir is supposed to be stable across sessions. Current design: no worktree, bare writes to `.pi-gsd/memory/`. Revisit if we ever see concurrent-dream corruption.

2. **Where does `AGENTS.md` end and `memory/*.md` begin?** Both are "project memory." Current rule: AGENTS.md is human-curated, memory/ is dream-curated. But the dream could drift into AGENTS.md territory and vice versa. Consider making memory/ a strict subset that never duplicates AGENTS.md.

3. **Should a failing wave roll back successful earlier plans in the same wave?** Current design: no — successful worktrees merge, failed ones are left standing for resume. Alternative: all-or-nothing wave semantics. Need to play with both and see which feels right.

4. **Per-phase model override in PLAN.md frontmatter?** E.g. `model: "opus"` on a planner that needs deep reasoning. Easy to add, but when does it help vs just setting the profile globally?

5. **How do we test the LLM-driven parts in CI without burning tokens?** Faux provider covers a lot but not all. Should we record-and-replay real model runs and golden-file them? Or only test the deterministic layer in CI and leave LLM tests as a manual `npm run test:llm` gate?

---

## ✅ Done (for reference — see git log for details)

- Phase 1: scaffold + runtime smoke (2 commits)
- Phase 2: plan format (schema, parser, emitter, 7 tests)
- Phase 3: memory/state, agents-md, subagent prompt renderer
- Phase 4: deterministic hooks (bash/path/injection, 11 tests)
- Phase 5: wave scheduler + git worktree helpers (8 tests)
- Phase 6: `/gsd-init`, `/gsd-discuss`, `/gsd-plan` + planner/checker role prompts
- Phase 7: `/gsd-execute` with worktree provisioning + resume state
- Phase 8: deterministic verify layer + `/gsd-ship`, `/gsd-status`, `/gsd-resume`
- Phase 9: SessionMemory + Dream + dream-lock (direct port of claude-code autoDream), `/gsd-dream`, `/gsd-memory`, `session_shutdown` hook, 13 tests
- Phase 10: full E2E smoke on a scratch git repo + user-friendly README
- Published to github.com/seanGSISG/pi-gsd as public MIT-licensed
