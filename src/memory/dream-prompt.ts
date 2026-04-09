/**
 * Dream consolidation prompt. Structurally identical to claude-code's
 * consolidationPrompt.ts — a 4-phase reflective pass (Orient → Gather →
 * Consolidate → Prune/Index) — with vocabulary adapted for pi-gsd's
 * phase-oriented workflow and memory layout (.pi-gsd/memory/).
 */

const ENTRYPOINT_NAME = "MEMORY.md";
const MAX_ENTRYPOINT_LINES = 200;

export interface DreamPromptContext {
	memoryRoot: string; // absolute path to .pi-gsd/memory
	projectRoot: string;
	sessionIds: string[];
	extra?: string;
}

export function buildDreamPrompt(ctx: DreamPromptContext): string {
	const sessionList = ctx.sessionIds.map((id) => `- ${id}`).join("\n");
	return `# Dream: Memory Consolidation

You are performing a dream — a reflective pass over your memory files. Synthesize what you've learned recently into durable, well-organized memories so that future pi-gsd phases can orient quickly.

Memory directory: \`${ctx.memoryRoot}\`
Project root: \`${ctx.projectRoot}\`

---

## Phase 1 — Orient

- \`ls\` the memory directory to see what already exists
- Read \`${ENTRYPOINT_NAME}\` to understand the current index
- Skim existing topic files so you improve them rather than creating duplicates
- If \`logs/\` exists, skim recent daily entries for uncaptured signal

## Phase 2 — Gather recent signal

Look for new information worth persisting. Sources in priority order:

1. **Daily logs** (\`logs/YYYY/MM/YYYY-MM-DD.md\`) — append-only stream from SessionMemory
2. **Phase summaries** under \`../phases/*/SUMMARY.md\` — executor deviations, decisions, gotchas
3. **Phase verifications** under \`../phases/*/VERIFICATION.md\` — must-haves that failed, unresolved items
4. **Existing memories that drifted** — facts contradicted by the current codebase

Grep narrowly; do not exhaustively read large files.

## Phase 3 — Consolidate

For each thing worth remembering, write or update a memory file in \`${ctx.memoryRoot}\`. Use one of four types via frontmatter:

    ---
    type: context | user-goals | technique | contradiction-log
    date: YYYY-MM-DD
    ---

- **context**: immutable project facts (stack, architecture, conventions)
- **user-goals**: current milestone / sprint / success criteria
- **technique**: reusable patterns discovered during phases
- **contradiction-log**: known conflicts where new evidence disproves old memory

Focus on:
- Merging new signal into existing topic files rather than creating near-duplicates
- Converting relative dates ("yesterday", "last week") to absolute dates
- Deleting contradicted facts — if a phase verified a bug in an old assumption, fix the source memory

## Phase 4 — Prune and index

Update \`${ENTRYPOINT_NAME}\` so it stays under ${MAX_ENTRYPOINT_LINES} lines AND under ~25KB. It's an **index**, not a dump — each entry one line under ~150 characters: \`- [Title](file.md) — one-line hook\`. Never write content directly into it.

- Remove pointers to stale or superseded memories
- Demote verbose entries: if an index line is over ~200 chars, move the detail into the topic file
- Resolve contradictions — if two files disagree, fix the wrong one

---

Return a brief summary of what you consolidated, updated, or pruned. If nothing changed (memories are already tight), say so.

## Sessions since last consolidation (${ctx.sessionIds.length})

${sessionList || "(none — forced dream)"}${ctx.extra ? `\n\n## Additional context\n\n${ctx.extra}` : ""}
`;
}
