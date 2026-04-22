import { stripHtml } from "./utils";

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

  return `You are a Product Architect evaluating this idea. Be BRUTALLY HONEST.

## Context Files
Read these files for context:
- ${narrativeRef} (project vision & scope) - if it exists
- @CLAUDE.md (technical guidelines) - if it exists

## Idea to Evaluate
**Title:** ${title}

**Description:**
${description}

## Your Evaluation Task
Evaluate this idea from these perspectives:

1. **YAGNI (You Ain't Gonna Need It)**: Is this feature truly needed? Will it provide value?
2. **Scope Creep Risk**: Does this expand the project scope unnecessarily?
3. **Scalability**: Will this scale with the product growth?
4. **Technical Feasibility**: Is this technically achievable with reasonable effort?
5. **Alignment with Vision**: Does this fit the product's core mission?
6. **Implementation Complexity**: How hard is this to build?

## Output Format
You MUST provide your evaluation as markdown with EXACTLY these sections:

## Summary Verdict
[One sentence: Strong Yes / Yes / Maybe / No / Strong No]

## Strengths
- Point 1
- Point 2
(List the key strengths of this idea)

## Concerns
- Point 1
- Point 2
(List the main concerns, risks, or issues)

## Recommendations
- What should be considered before implementing
- Any suggested modifications to the idea

## Priority
[PRIORITY: low/medium/high] - Your reasoning for this priority level
(Based on urgency, impact, and alignment with project goals. Be honest - not everything is high priority!)

## Complexity
[COMPLEXITY: trivial/low/medium/high/very_high] - Your assessment
(trivial = few lines, low = simple change, medium = moderate effort, high = significant work, very_high = major undertaking)

## Final Score
[X/10] - Brief justification for the score

---
Be direct. Don't sugarcoat. Point out both good and bad aspects.`;
}

/**
 * Quick fix prompt for cards in the Bugs column. Asks Claude to diagnose,
 * fix, and hand back a short summary + test checklist.
 */
export function buildQuickFixPrompt(card: { title: string; description: string }): string {
  const title = stripHtml(card.title);
  const description = stripHtml(card.description);

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

  return `You are a Product Strategist. Let's brainstorm and refine this idea together.

## Idea to Discuss
**Title:** ${title}

**Description:**
${description}

## Your Role
1. Ask clarifying questions to understand the idea better
2. Challenge assumptions - consider YAGNI, scope creep risks
3. Explore alternatives and improvements
4. Help refine the concept into something actionable
5. Consider technical feasibility and implementation complexity

## Discussion Guidelines
- Be curious and ask probing questions
- Point out potential issues constructively
- Suggest improvements or alternatives
- Help prioritize if the idea is too broad
- Be honest but collaborative

## Ideafy MCP Tools Available
- mcp__ideafy__save_opinion - Save your final thoughts to the card
- mcp__ideafy__update_card - Update card fields (including priority)
- mcp__ideafy__get_card - Get card details

Card ID: ${card.id}

## CRITICAL: When Discussion Ends
Before finishing, you MUST do THREE things:

### 1. Update Priority
Based on our discussion, update the card priority:
\`\`\`
mcp__ideafy__update_card({ id: "${card.id}", priority: "low" | "medium" | "high" })
\`\`\`
Be BRUTALLY HONEST - not everything is high priority!

### 2. Update Complexity
Based on the scope of the idea, update the card complexity:
\`\`\`
mcp__ideafy__update_card({ id: "${card.id}", complexity: "trivial" | "low" | "medium" | "high" | "very_high" })
\`\`\`
(trivial = few lines, low = simple change, medium = moderate effort, high = significant work, very_high = major undertaking)

### 3. Save Your Opinion
Your opinion MUST include EXACTLY these sections:
\`\`\`
mcp__ideafy__save_opinion({ id: "${card.id}", aiOpinion: "## Summary Verdict\\n[Strong Yes / Yes / Maybe / No / Strong No]\\n\\n## Strengths\\n- Point 1\\n- Point 2\\n\\n## Concerns\\n- Point 1\\n- Point 2\\n\\n## Recommendations\\n- Recommendation 1\\n- Recommendation 2\\n\\n## Priority\\n[PRIORITY: low/medium/high] - Your reasoning\\n\\n## Final Score\\n[X/10] - Brief justification" })
\`\`\`

Do NOT end the session without updating priority, complexity, and saving your opinion.

Let's start! What would you like to explore about this idea?`;
}
