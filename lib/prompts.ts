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

IMPORTANT: Do NOT implement yet - plan only.
IMPORTANT: Do NOT call save_plan, save_tests, save_opinion, or any MCP tools to save results. Do NOT ask whether to save. Output the complete plan directly as your response text. Your output will be automatically saved to the card.`;

    case "implementation": {
      const styleContract = buildTestStyleContract({
        language: detectCardLanguage({ title: card.title, description: card.description }),
      });
      return `Ideafy: ${card.id}

Read card via MCP (mcp__ideafy__get_card). Follow the approved plan in solutionSummary.

Task: Implement "${title}".

## After implementing the code — COMMIT YOUR CHANGES

You are working inside a feature-branch git worktree. Merge & Complete will later squash these commits into main, so you MUST commit your work here. Do this BEFORE outputting test scenarios:

1. Stage ONLY files you actually modified or created for this task. Do NOT run \`git add -A\` — this worktree contains a \`node_modules\` symlink and other untracked artifacts that must NOT be staged. Use one of:
   - \`git add <file1> <file2> ...\` (explicit list — preferred)
   - \`git add -u\` (only already-tracked modifications; use if you did not create any new files)
2. Commit with a conventional commits message referencing the card:
   \`git commit -m "<type>(${commitRef}): <short imperative description>"\`
   - Type: \`feat\` for new functionality, \`fix\` for bug fixes, \`refactor\` for non-behavioral changes, \`chore\` for tooling.
   - Example: \`feat(${commitRef}): stash and restore main-repo uncommitted changes on merge\`
3. Verify: run \`git status\` and confirm the worktree is clean (no modified tracked files). The node_modules symlink staying as \`??\` untracked is fine and expected.

If you created multiple logically separate changes, use multiple commits.

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
- Do NOT include code summaries, file lists, or implementation details in your output
- Your response text will be automatically saved as test scenarios

${styleContract}

IMPORTANT: Do NOT call save_plan, save_tests, save_opinion, or any MCP tools to save results.`;
    }

    case "retest":
      return `Ideafy: ${card.id}

Read card via MCP (mcp__ideafy__get_card). Review previous implementation and test scenarios.

Task: "${title}" failed during testing.

User will describe the error - wait and fix. If you make code changes, you MUST commit them in this worktree before finishing:
- Stage only files you modified: \`git add <file>\` or \`git add -u\` (never \`git add -A\`).
- Commit message format: \`fix(${commitRef}): <short description of the fix>\`.
- Verify worktree is clean with \`git status\` after commit (untracked \`node_modules\` symlink is expected).

IMPORTANT: Do NOT call save_plan, save_tests, save_opinion, or any MCP tools to save results. Do NOT ask whether to save. Output your response directly as text. Your output will be automatically saved to the card.`;
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
