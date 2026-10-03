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
 * A leaf module on purpose: the MCP server bundles it (via
 * mcp-server/shared.ts), and whatever it imports goes into the plugin too.
 */

const PRIOR_DECISIONS_CHECK = `Check this card against the project's other cards before you commit to an approach. Use this card's \`id\` and \`projectId\` (get_card returns both):
- Past decisions: call \`search_cards\` with the \`projectId\`, 2-3 keywords from the task, and this card's \`id\` as \`excludeCardId\`. The search matches words literally, so when the cards are not written in English, search in their language as well as in English. Read each hit by its status:
  - completed, test or progress: a decision. If this work contradicts it, that is a contradiction. A newer decision overrides an older one, but say why it should.
  - withdrawn: tried and abandoned, not a decision. Never call it a contradiction. Mention it as a precedent only when the reason it was dropped applies here too.
  Open a card with get_card only when its snippet is not enough.
- Open work: always call \`list_open_work\` with the same \`projectId\` and \`excludeCardId\`, even when you do not know the files yet: without \`files\` it still lists every open card, and that is how dependencies show up. Add the files this card will change as \`files\` when you know them. Rows that share a file list it under \`overlap\`; otherwise compare against each card's files yourself. Call it an overlap only when you can name a concrete shared file; then name the card, the shared file and which of the two should land first. When this card relies on something an open card brings in but no file is shared, that is a dependency, not an overlap.
- Mention a card only if, without it, your verdict, a recommendation or a plan step would be different. A card that holds no decision (a recently closed bug, a loosely related feature) is never a precedent. If it is still useful, cite it inline where it matters, not as a related card.
- Name a card by its bare displayId (IDE-318), never in backticks: it becomes a clickable link when saved.
- If \`search_cards\` or \`list_open_work\` is not available, or returns an error, skip this whole check and go straight on to the evaluation or the plan. Do not make up for the missing tool: never open the database (\`kanban.db\`, \`sqlite3\`), never query the card tables or the app's local API, never walk the codebase looking for other cards.`;

/**
 * A chain's other members are related work whether or not `search_cards`
 * finds them — a predecessor with no shared keyword never turns up there. The
 * chain comes from get_card's `chain` field or the prompt's own `## Chain`
 * section, so this part stands outside the check above and its "skip it when
 * the tools are missing" clause.
 */
const CHAIN_CONTEXT = `Chain: when get_card returns a \`chain\` field for this card, or this prompt has a \`## Chain\` section, the card is one step of a chain of cards. Its predecessors and successors are related work even when \`search_cards\` does not find them, and this part applies even when the check above was skipped. Name each by its bare displayId; a member without one (a draft) by its title.
- Listing them is not enough: open at most 3 of them with get_card — the direct successor (the first member after this card) if there is one, then the predecessors that are neither completed nor withdrawn, nearest first, up to that cap. A draft has no displayId and cannot be opened; name it and move on.
- Read only their \`aiOpinion\` and \`solutionSummary\`, and ask one question: does this card's direction contradict what they decided, or break an assumption the successor is built on? That content contradiction is the only conflict meant here — a shared file is already \`list_open_work\`'s job.`;

/**
 * For every surface that writes a plan. The plan keeps its four headings:
 * conflicts go under Edge Cases, and extra work taken into scope becomes its
 * own labelled step under Implementation Steps.
 */
export const PRIOR_DECISIONS_RULE = `${PRIOR_DECISIONS_CHECK}
- If an open card brings in something this card needs to work correctly, or breaks it, that is extra work. When it is a precondition for this card, add it as its own step under Implementation Steps labelled "(because of <displayId>)"; otherwise suggest it as a note for the other card. Never widen the scope silently.
- Contradictions, precedents and overlaps go under Edge Cases; dependencies go under Dependencies. Do not add a heading for them. A card sits under one heading only: a dependency is not repeated in Edge Cases, and an overlap you checked and ruled out is not written down.
If there is no contradiction, precedent, overlap or dependency, write nothing about it.

${CHAIN_CONTEXT}
- Under Dependencies, list the chain's predecessors and successors in chain order, each with its status.
- If a predecessor is neither completed nor withdrawn, add one sentence in the same section naming it as a sequencing risk: this card may land before work it builds on. It is a warning, not a blocker — do not stop, and do not reshape the plan around it.
- A finding from the chain read goes onto that member's line under Dependencies as half a sentence. A contradiction also gets one sentence under Edge Cases — the one place a card may sit under two headings. With no finding, the chain lines stay exactly as they would have been.`;

/**
 * For the idea evaluation (one-shot Evaluate and the interactive ideation
 * session), which reports what it found in its own optional section. Only
 * here do ideas that were never decided count: a new idea can duplicate one
 * already waiting in Ideation or Backlog, and a plan cannot.
 */
export const PRIOR_DECISIONS_EVALUATION_RULE = `${PRIOR_DECISIONS_CHECK}
- Duplicates: call \`search_cards\` once more with the same keywords and \`statuses: ["ideation", "backlog"]\`. Those cards are ideas, not decisions; mention one only when it describes the same idea.
- Report what you found under \`## Related Cards\`, one line per card: its displayId, the kind (contradiction, precedent, duplicate, overlap or dependency, written in the output language), then what it decided or touches and why it matters here. Every kind keeps its own word in the output language; contradiction and overlap never share one. In Turkish: çelişki, emsal, kopya, dosya çakışması, bağımlılık; for the chain öncül, ardıl. At most 3 lines, chain lines excluded.

${CHAIN_CONTEXT}
- List the chain's predecessors and successors under \`## Related Cards\` too, in chain order, with the kind predecessor or successor (written in the output language) and each one's status. A chain member that is also a contradiction or an overlap gets one line, not two.
- A finding from the chain read goes onto that member's predecessor or successor line, after its status, as half a sentence. It never opens a line of its own; with no finding the line stays as it is.

If there is no contradiction, precedent, duplicate, overlap or dependency and the card is in no chain, leave \`## Related Cards\` out entirely.
If the check was skipped because the tools were missing, \`## Related Cards\` holds only the chain lines — leave it out when there is no chain — and do not explain why.`;

/**
 * For the runs that write code (implementation and retest) and a session
 * opened by hand on a planned card. The chain's earlier cards may already have
 * built the helper this card is about to write, and their core flow is the
 * behaviour this change is most likely to break. Capped at three reads so a
 * long chain does not cost more than a short one.
 */
export const CHAIN_IMPLEMENTATION_RULE = `Chain: when get_card returns a \`chain\` field for this card, the card is one step of a chain, and the cards before it may already have built what you need. With no \`chain\` field, ignore this part.
- Before you write code, open with get_card the nearest predecessors whose status is completed or test — at most 3, nearest first — and read only their \`solutionSummary\` and \`testScenarios\`. A draft has no displayId and cannot be opened; skip it.
- Build on what they brought in: reuse their helpers, routes and types instead of writing new ones that do the same job. Their plan is not the code — find what it names in the code before you rely on it, and when the two disagree, the code wins.
- In the final checklist, add at most one item from a predecessor's core group (\`## Core flow\` / \`## Temel akış\`) that this change could break, as a step under \`## Regression\` (\`## Regresyon\` on a Turkish card) naming that predecessor's displayId. Never put it in the core group.
- If no predecessor is completed or in test, or none of their core items is at risk, add nothing.`;
