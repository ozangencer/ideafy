/**
 * Centralized prompt builders for Claude Code integration.
 * Most builders live under `@/lib/prompts/*` (see barrel re-exports below);
 * `buildPhasePrompt`, `detectPhase`, and `buildConflictPrompt` stay in this
 * file because the phase prompt is what the solo and cloud repos diverge on,
 * and keeping the divergence on a single file keeps merges simple.
 */

// ------------------------------------------------------------------
// Re-exports (public API preserved)
// ------------------------------------------------------------------

export { stripHtml, convertToTipTapTaskList, escapeShellArg } from "./prompts/utils";
export {
  type SavedImage,
  saveCardImagesToTemp,
  extractConversationImages,
  generateImageReferences,
  getCardImageDir,
} from "./prompts/images";
export { buildEvaluatePrompt, buildQuickFixPrompt, buildIdeationPrompt } from "./prompts/card";
export { buildTestTogetherPrompt, buildTestGenerationPrompt } from "./prompts/testing";
export {
  type NarrativeData,
  buildNarrativePrompt,
  generateFallbackContent,
} from "./prompts/narrative";

// ------------------------------------------------------------------
// Phase prompt (kept in place because cloud customises this prompt's body)
// ------------------------------------------------------------------

import { stripHtml } from "./prompts/utils";
import { buildTestStyleContract, detectCardLanguage } from "./prompts/test-style";

const NO_SAVE_TOOLS_RULE =
  "Do NOT call save_plan, save_tests, save_opinion, or any MCP save tools — output your response as text; it is auto-saved to the card.";

function buildCommitInstructions(commitRef: string, defaultType: "feat" | "fix"): string {
  return `Commit your work in this feature-branch worktree before finishing (Merge & Complete will squash later):
1. Stage only the files you touched — \`git add <file>\` or \`git add -u\`. NEVER \`git add -A\` (worktree contains a node_modules symlink that must stay untracked).
2. Conventional commit referencing the card: \`git commit -m "${defaultType}(${commitRef}): <short imperative description>"\` (use \`feat\`/\`fix\`/\`refactor\`/\`chore\` as appropriate).
3. \`git status\` should show a clean tracked tree (untracked node_modules symlink is expected).`;
}

export type Phase = "planning" | "implementation" | "retest";

export interface CardForPrompt {
  id: string;
  title: string;
  description: string;
  solutionSummary?: string | null;
  testScenarios?: string | null;
}

/** Detect which phase the card is in based on existing content. */
export function detectPhase(card: { solutionSummary: string | null; testScenarios: string | null }): Phase {
  const hasSolution = card.solutionSummary && stripHtml(card.solutionSummary) !== "";
  const hasTests = card.testScenarios && stripHtml(card.testScenarios) !== "";

  if (!hasSolution) return "planning";
  if (!hasTests) return "implementation";
  return "retest";
}

export function buildPhasePrompt(
  phase: Phase,
  card: CardForPrompt,
  displayId?: string | null
): string {
  const title = stripHtml(card.title);
  const commitRef = displayId || card.id.slice(0, 8);

  switch (phase) {
    case "planning":
      return `Ideafy: ${card.id}

Read card via MCP (mcp__ideafy__get_card). Review title, description, and any existing notes.

Task: Create implementation plan for "${title}".

Plan format:
- Files to Modify
- Implementation Steps
- Edge Cases
- Dependencies

Must include at the end:
[COMPLEXITY: trivial/low/medium/high/very_high]
[PRIORITY: low/medium/high]

Plan only — do NOT implement. ${NO_SAVE_TOOLS_RULE}`;

    case "implementation": {
      const styleContract = buildTestStyleContract({
        language: detectCardLanguage({ title: card.title, description: card.description }),
      });
      return `Ideafy: ${card.id}

Read card via MCP (mcp__ideafy__get_card). Follow the approved plan in solutionSummary.

Task: Implement "${title}".

## After implementing — commit before outputting tests

${buildCommitInstructions(commitRef, "feat")}

Use multiple commits if changes are logically separate.

## FINAL response format

After committing, your FINAL response must be ONLY manual test scenarios in this EXACT format:

## Test Scenarios

### Happy Path
- [ ] Description of what to test manually and expected result
- [ ] Another test case

### Edge Cases
- [ ] Edge case to verify

### Regression
- [ ] Existing feature that should still work

Rules:
- Every line must be a markdown checkbox (- [ ])
- Write actionable manual test steps, NOT a summary of code changes
- Do NOT include code summaries, file lists, or implementation details

${styleContract}

${NO_SAVE_TOOLS_RULE}`;
    }

    case "retest":
      return `Ideafy: ${card.id}

Read card via MCP (mcp__ideafy__get_card). Review previous implementation and test scenarios.

Task: "${title}" failed during testing.

User will describe the error — wait, then fix. If you change code:

${buildCommitInstructions(commitRef, "fix")}

${NO_SAVE_TOOLS_RULE}`;
  }
}

// ------------------------------------------------------------------
// Conflict resolution prompt
// ------------------------------------------------------------------

export function buildConflictPrompt(
  displayId: string,
  branchName: string,
  conflictFiles: string[]
): string {
  const filesStr = conflictFiles.join(", ");

  return `Rebase conflict resolution for ${displayId}. Branch: ${branchName}. Conflicting files: ${filesStr}. Help me resolve the git rebase conflict. Open the conflicting files, find the conflict markers, resolve them, then run git add and git rebase --continue.`;
}
