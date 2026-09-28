import type { AiPlatform, Voice } from "@/lib/types";
import { DEFAULT_VOICE } from "@/lib/types";
import { stripHtml } from "./utils";
import { detectCardLanguage } from "./test-style";
import { buildVoicePrompt } from "./voice-style";
import { getProviderContextRef } from "@/lib/ai/provider-context-ref";
import { markUntrusted, markUntrustedInline } from "@/lib/untrusted-content";
import { PRIOR_DECISIONS_EVALUATION_RULE } from "./prior-decisions";

/**
 * Shared output schema for idea evaluation. Used by the one-shot evaluate
 * prompt and the interactive ideation prompt so both produce a structurally
 * identical aiOpinion payload.
 */
const EVALUATION_OUTPUT_SCHEMA = `## Summary Verdict
[One sentence: Strong Yes / Yes / Maybe / No / Strong No]

## Related Cards
[Optional — only when an earlier card contradicts this idea, set a precedent for it, already describes the same idea, or open work overlaps it. One line per card: displayId, the kind (contradiction, precedent, duplicate or overlap), what it decided or touches, and why it matters here. Leave the whole section out otherwise.]

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
[X/10] — brief justification`;

/**
 * The "check earlier cards" step for both evaluation prompts. The one-shot
 * Evaluate run never calls get_card, so the ids the MCP tools need are spelled
 * out here. Without a project there is nothing to search, so it drops out.
 */
function buildPriorDecisionsSection(card: { id: string; projectId?: string | null }): string {
  if (!card.projectId) return "";
  return `
## Earlier Decisions
Card id: ${card.id} · projectId: ${card.projectId}

${PRIOR_DECISIONS_EVALUATION_RULE}
`;
}

/**
 * Evaluate prompt for cards entering the Ideation column.
 * Asks Claude to act as a Product Architect and return a structured verdict.
 */
export function buildEvaluatePrompt(
  card: {
    id: string;
    projectId?: string | null;
    title: string;
    description: string;
    externallyAuthored?: boolean;
  },
  narrativePath: string | null | undefined,
  voice: Voice = DEFAULT_VOICE,
  provider: AiPlatform,
): string {
  const external = card.externallyAuthored === true;
  const title = markUntrustedInline(stripHtml(card.title), external);
  const description = markUntrusted(stripHtml(card.description), external);

  const narrativeRef = narrativePath
    ? `@${narrativePath}`
    : "@docs/product-narrative.md";

  const voicePrompt = buildVoicePrompt(voice, "opinion");
  const priorDecisions = buildPriorDecisionsSection(card);

  return `You are a Product Architect. Evaluate this idea — be brutally honest, point out both good and bad.

## Context Files (read if they exist)
- ${narrativeRef} (project vision & scope)
- ${getProviderContextRef(provider)}

## Idea to Evaluate
**Title:** ${title}

**Description:**
${description}

## Evaluation Lenses
YAGNI · scope creep risk · scalability · technical feasibility · alignment with vision · implementation complexity.
${priorDecisions}
${voicePrompt}

## Output Format
Markdown with exactly these sections (Related Cards is the only optional one). Keep every \`##\` heading exactly as written, in English, even when you write the content in another language: the app reads the verdict and the scores from them.

${EVALUATION_OUTPUT_SCHEMA}`;
}

/**
 * Quick fix prompt for cards in the Bugs column. Asks Claude to diagnose,
 * fix, and hand back a short summary + test checklist.
 */
export function buildQuickFixPrompt(
  card: { title: string; description: string; externallyAuthored?: boolean },
  voice: Voice = DEFAULT_VOICE,
  provider: AiPlatform,
): string {
  const external = card.externallyAuthored === true;
  const title = markUntrustedInline(stripHtml(card.title), external);
  const description = markUntrusted(stripHtml(card.description), external);
  const styleContract = buildVoicePrompt(voice, "tests", {
    language: detectCardLanguage({ title: card.title, description: card.description }),
  });
  const summaryVoice = buildVoicePrompt(voice, "quick_fix");

  return `You are a senior developer. Fix this bug quickly and efficiently.

## Project Context (read before changing code)
- ${getProviderContextRef(provider)}

## Bug Report
${title}

## Description
${description}

## Instructions
1. Analyze the bug description
2. Find the root cause in the codebase
3. Implement the fix
4. Verify the fix works

## Output Requirements
After fixing the bug, provide a brief summary in this format, with the \`## Quick Fix Summary\` heading kept in English whatever language the rest is in:

## Quick Fix Summary
- **Root Cause:** Brief description of what caused the bug
- **Fix Applied:** What was changed to fix it
- **Files Modified:** List of files that were changed

Then the test checklist, opening with its core group: \`## Core flow\` on an English card, \`## Temel akış\` on a Turkish one. Write the steps from what you actually changed — "Bug no longer reproduces" names nothing a person can walk, and the style contract below rejects it. That heading is also what separates the checklist from the summary above, so it must be present and at \`##\` level.

${summaryVoice}

${styleContract}

Focus on fixing the bug efficiently. Do NOT write extensive documentation or plans.`;
}

/**
 * Interactive brainstorming prompt for an ideation session. Unlike
 * `buildEvaluatePrompt`, this is conversational and expects the model to
 * call MCP tools at the end of the session.
 */
export function buildIdeationPrompt(
  card: {
    id: string;
    projectId?: string | null;
    title: string;
    description: string;
    externallyAuthored?: boolean;
  },
  voice: Voice = DEFAULT_VOICE,
  provider: AiPlatform,
): string {
  const external = card.externallyAuthored === true;
  const title = markUntrustedInline(stripHtml(card.title), external);
  const description = markUntrusted(stripHtml(card.description), external);
  const voicePrompt = buildVoicePrompt(voice, "chat");

  return `You are a Product Strategist. Brainstorm and refine this idea with the user — ask probing questions, challenge assumptions (YAGNI, scope creep), explore alternatives, weigh feasibility and complexity. Be honest but collaborative.

${voicePrompt}

## Project Context (skim before responding)
- ${getProviderContextRef(provider)}

## Idea to Discuss
**Title:** ${title}

**Description:**
${description}

Card ID: ${card.id}
${buildPriorDecisionsSection(card)}
## Available MCP Tools
- mcp__ideafy__get_card · mcp__ideafy__update_card · mcp__ideafy__save_opinion · mcp__ideafy__search_cards · mcp__ideafy__list_open_work

## When the Discussion Ends
Before finishing, do all three:

1. \`mcp__ideafy__update_card\` with \`priority: "low" | "medium" | "high"\` (be honest — not everything is high).
2. \`mcp__ideafy__update_card\` with \`complexity: "trivial" | "low" | "medium" | "high" | "very_high"\`.
3. \`mcp__ideafy__save_opinion\` with \`aiOpinion\` as markdown matching this schema exactly:

${EVALUATION_OUTPUT_SCHEMA}

Do NOT end the session without all three.

Let's start — what would you like to explore about this idea?`;
}
