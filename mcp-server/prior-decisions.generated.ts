// ─────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
//
// Verbatim copy of lib/prompts/prior-decisions.ts, written by
// scripts/sync-mcp-shared.mjs on every mcp-server build. Edit the source,
// not this file; anything you change here is overwritten on the next build.
// ─────────────────────────────────────────────────────────────────────────

/**
 * How an evaluation or a plan checks itself against the project's other cards.
 *
 * Without this, the model only knows about a past decision when the user
 * links the card by hand with [[. The rule points it at two MCP tools
 * instead: search_cards for what was already decided (completed, withdrawn,
 * in flight) and list_open_work for unmerged work touching the same files.
 * Retrieval is the model's job; the tools only return short rows, never full
 * card HTML or diffs.
 *
 * Mode-independent on purpose: no branch, code or test wording beyond what a
 * Work project can also read, so a non-git project runs the same rule.
 *
 * Zero imports on purpose: scripts/sync-mcp-shared.mjs copies this file
 * verbatim into mcp-server/prior-decisions.generated.ts, which has to compile
 * inside mcp-server without the `@/` alias or the repo's lib/.
 */

const PRIOR_DECISIONS_CHECK = `Check this card against the project's other cards before you commit to an approach. Use this card's \`id\` and \`projectId\` (get_card returns both):
- Past decisions: call \`search_cards\` with the \`projectId\`, 2-3 keywords from the task, and this card's \`id\` as \`excludeCardId\`. Read each hit by its status:
  - completed, test or progress: a decision. If this work contradicts it, that is a contradiction. A newer decision overrides an older one, but say why it should.
  - withdrawn: tried and abandoned, not a decision. Never call it a contradiction. Mention it as a precedent only when the reason it was dropped applies here too.
  Open a card with get_card only when its snippet is not enough.
- Open work: call \`list_open_work\` with the same \`projectId\` and \`excludeCardId\`, plus the files this card will change as \`files\` once you know them. Rows that share a file list it under \`overlap\`; otherwise compare against each card's files yourself. On an overlap, name the card, the shared file and which of the two should land first.
- Name a card by its bare displayId (IDE-318), never in backticks: it becomes a clickable link when saved.
- If these tools are not available, skip the check.`;

/**
 * For every surface that writes a plan. The plan keeps its four headings:
 * conflicts go under Edge Cases, and extra work taken into scope becomes its
 * own labelled step under Implementation Steps.
 */
export const PRIOR_DECISIONS_RULE = `${PRIOR_DECISIONS_CHECK}
- If an open card brings in something this card needs to work correctly, or breaks it, that is extra work. When it is a precondition for this card, add it as its own step under Implementation Steps labelled "(because of <displayId>)"; otherwise suggest it as a note for the other card. Never widen the scope silently.
- Contradictions, precedents and overlaps go under Edge Cases. Do not add a heading for them.
If there is no contradiction, precedent or overlap, write nothing about it.`;

/**
 * For the idea evaluation (one-shot Evaluate and the interactive ideation
 * session), which reports what it found in its own optional section. Only
 * here do ideas that were never decided count: a new idea can duplicate one
 * already waiting in Ideation or Backlog, and a plan cannot.
 */
export const PRIOR_DECISIONS_EVALUATION_RULE = `${PRIOR_DECISIONS_CHECK}
- Duplicates: call \`search_cards\` once more with the same keywords and \`statuses: ["ideation", "backlog"]\`. Those cards are ideas, not decisions; mention one only when it describes the same idea.
- Report what you found under \`## Related Cards\`, one line per card: its displayId, the kind (contradiction, precedent, duplicate or overlap, written in the output language), then what it decided or touches and why it matters here.
If there is no contradiction, precedent, duplicate or overlap, leave \`## Related Cards\` out entirely.`;
