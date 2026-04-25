import { stripHtml } from "./utils";
import { buildTestStyleContract, detectCardLanguage } from "./test-style";

/**
 * Shared output schema for idea evaluation. Used by the one-shot evaluate
 * prompt and the interactive ideation prompt so both produce a structurally
 * identical aiOpinion payload.
 */
const EVALUATION_OUTPUT_SCHEMA = `## Summary Verdict
[One sentence: Strong Yes / Yes / Maybe / No / Strong No]

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
 * Evaluate prompt for cards entering the Ideation column.
 * Asks Claude to act as a Product Architect and return a structured verdict.
 */
export function buildEvaluatePrompt(
  card: { title: string; description: string },
  narrativePath?: string | null,
): string {
  const title = stripHtml(card.title);
  const description = stripHtml(card.description);

  const narrativeRef = narrativePath
    ? `@${narrativePath}`
    : "@docs/product-narrative.md";

  return `You are a Product Architect. Evaluate this idea — be brutally honest, point out both good and bad.

## Context Files (read if they exist)
- ${narrativeRef} (project vision & scope)
- @CLAUDE.md (technical guidelines)

## Idea to Evaluate
**Title:** ${title}

**Description:**
${description}

## Evaluation Lenses
YAGNI · scope creep risk · scalability · technical feasibility · alignment with vision · implementation complexity.

## Output Format
Markdown with exactly these sections:

${EVALUATION_OUTPUT_SCHEMA}`;
}

/**
 * Quick fix prompt for cards in the Bugs column. Asks Claude to diagnose,
 * fix, and hand back a short summary + test checklist.
 */
export function buildQuickFixPrompt(card: { title: string; description: string }): string {
  const title = stripHtml(card.title);
  const description = stripHtml(card.description);
  const styleContract = buildTestStyleContract({
    language: detectCardLanguage({ title: card.title, description: card.description }),
  });

  return `You are a senior developer. Fix this bug quickly and efficiently.

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
After fixing the bug, provide a brief summary in this format:

## Quick Fix Summary
- **Root Cause:** Brief description of what caused the bug
- **Fix Applied:** What was changed to fix it
- **Files Modified:** List of files that were changed

## Test Scenarios
- [ ] Bug no longer reproduces
- [ ] Related functionality still works
- [ ] No regression in existing tests

${styleContract}

Focus on fixing the bug efficiently. Do NOT write extensive documentation or plans.`;
}

/**
 * Interactive brainstorming prompt for an ideation session. Unlike
 * `buildEvaluatePrompt`, this is conversational and expects the model to
 * call MCP tools at the end of the session.
 */
export function buildIdeationPrompt(card: { id: string; title: string; description: string }): string {
  const title = stripHtml(card.title);
  const description = stripHtml(card.description);

  return `You are a Product Strategist. Brainstorm and refine this idea with the user — ask probing questions, challenge assumptions (YAGNI, scope creep), explore alternatives, weigh feasibility and complexity. Be honest but collaborative.

## Idea to Discuss
**Title:** ${title}

**Description:**
${description}

Card ID: ${card.id}

## Available MCP Tools
- mcp__ideafy__get_card · mcp__ideafy__update_card · mcp__ideafy__save_opinion

## When the Discussion Ends
Before finishing, do all three:

1. \`mcp__ideafy__update_card\` with \`priority: "low" | "medium" | "high"\` (be honest — not everything is high).
2. \`mcp__ideafy__update_card\` with \`complexity: "trivial" | "low" | "medium" | "high" | "very_high"\`.
3. \`mcp__ideafy__save_opinion\` with \`aiOpinion\` as markdown matching this schema exactly:

${EVALUATION_OUTPUT_SCHEMA}

Do NOT end the session without all three.

Let's start — what would you like to explore about this idea?`;
}
