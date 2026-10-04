/**
 * How an idea is evaluated, wherever the evaluation is written: one-shot
 * Evaluate, the Ideate session, the in-app Opinion chat, and a terminal
 * session that only has get_card and save_opinion. The template, the chain
 * section and the "check earlier cards" step live here once, so every path
 * writes the same sections and fills Related Cards by the same rule.
 *
 * A leaf module on purpose: the MCP server bundles it (via
 * mcp-server/shared.ts), and whatever it imports goes into the plugin too.
 * mcp-server/__tests__/bundle-deps.test.ts fails the build if that drags in
 * lib/db, drizzle or Next.
 */

import { PRIOR_DECISIONS_EVALUATION_RULE } from "./prior-decisions";
import type { ChainCardRef, ChainContext } from "../chain-order";

/** A card's place in its chain, as the evaluate and ideation routes load it. */
export type PromptChain = ChainContext & { groupCode: string; groupName: string };

/**
 * Shared output schema for idea evaluation. Every evaluation path writes it,
 * so the aiOpinion payload is structurally identical whichever wrote it.
 */
export const EVALUATION_OUTPUT_SCHEMA = `## Summary Verdict
[VERDICT: strong_yes/yes/maybe/no/strong_no] — one sentence: Strong Yes / Yes / Maybe / No / Strong No, and why.

## Related Cards
[Optional — only when an earlier card contradicts this idea, set a precedent for it, already describes the same idea, open work overlaps it or brings in something it relies on, or when the card is in a chain, and only when it would change the verdict or a recommendation. One line per card: displayId, the kind (contradiction, precedent, duplicate, overlap, dependency, predecessor or successor), what it decided or touches, and why it matters here. Chain predecessors and successors are listed in chain order with their status. Leave the whole section out otherwise.]

## Strengths
- Key strengths of the idea

## Concerns
- Main concerns, risks, or issues

## Recommendations
- What to consider before implementing, suggested modifications

## Priority
[PRIORITY: low/medium/high] — reasoning. Be honest, not everything is high priority.

## Complexity
[COMPLEXITY: trivial/low/medium/high/very_high] — assessment.
(trivial = few lines, low = simple, medium = moderate, high = significant, very_high = major)

## Final Score
[SCORE: X/10] — brief justification

The four bracketed markers — [VERDICT: …], [PRIORITY: …], [COMPLEXITY: …], [SCORE: X/10] — each hold exactly one value and stay in English whatever language the rest is written in. The card's verdict, score, priority and complexity are read from them.`;

/** The line that keeps the template's headings machine-readable. */
export const EVALUATION_HEADINGS_RULE =
  "Markdown with exactly these sections (Related Cards is the only optional one). Keep every `##` heading exactly as written, in English, even when you write the content in another language: the app reads the verdict and the scores from them.";

/**
 * The "check earlier cards" step for the evaluation prompts. The one-shot
 * Evaluate run never calls get_card, so the ids the MCP tools need are spelled
 * out here. Without a project there is nothing to search, so it drops out.
 */
export function buildPriorDecisionsSection(card: { id: string; projectId?: string | null }): string {
  if (!card.projectId) return "";
  return `
## Earlier Decisions
Card id: ${card.id} · projectId: ${card.projectId}

${PRIOR_DECISIONS_EVALUATION_RULE}
`;
}

function chainLine(ref: ChainCardRef): string {
  const name = ref.displayId ? `${ref.displayId} · ${ref.title}` : `${ref.title} (draft, no displayId)`;
  return `${name} — ${ref.status}`;
}

/**
 * The card's chain, spelled out. Evaluate is one-shot and never calls
 * get_card, so its `chain` field would never reach the model; the route loads
 * it and it travels in the prompt instead. Independent of the project: a
 * chain is there to be read whether or not the MCP check can run.
 */
export function buildChainSection(chain: PromptChain | null | undefined): string {
  if (!chain) return "";
  const lines = [
    ...chain.predecessors.map((ref, i) => `${i + 1}. ${chainLine(ref)}`),
    `${chain.position}. (this card)`,
    ...chain.successors.map((ref, i) => `${chain.position + i + 1}. ${chainLine(ref)}`),
  ];
  const next = chain.next ? chainLine(chain.next) : "none — every member is completed or withdrawn";
  return `
## Chain
This card is ${chain.position}/${chain.total} in chain ${chain.groupCode} (${chain.groupName}), in chain order:
${lines.join("\n")}
Next open card in the chain: ${next}
`;
}

/**
 * The whole evaluation contract for a session that has nothing but the MCP
 * tools — get_card hands it out on an ideation card. The card's id, projectId
 * and chain come from get_card itself, which the rule already points at.
 */
export function buildEvaluationGuide(): string {
  return `${PRIOR_DECISIONS_EVALUATION_RULE}

Then write the evaluation in this template and save it with save_opinion (aiOpinion as markdown). ${EVALUATION_HEADINGS_RULE}

${EVALUATION_OUTPUT_SCHEMA}`;
}
