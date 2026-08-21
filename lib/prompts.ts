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
import { detectCardLanguage } from "./prompts/test-style";
import { buildVoicePrompt } from "./prompts/voice-style";
import { DEFAULT_VOICE, type Voice } from "./types";

const NO_SAVE_TOOLS_RULE =
  "Do NOT call save_plan, save_tests, save_opinion, or any MCP save tools — output your response as text; it is auto-saved to the card.";

function buildCommitInstructions(commitRef: string | null): string {
  // The card reference is a trailer rather than a subject prefix so the subject
  // stays the plain sentence it would have been. Without a resolvable display
  // ID there is nothing worth referencing — a UUID fragment reads like a ref
  // while matching no card at all — so that case just gets a normal commit.
  const reference = commitRef
    ? ` Reference the card with a trailer on its own line at the end of the message: \`git commit -m "<short imperative description>" -m "Card: ${commitRef}"\`. Add the trailer only when the commit advances this card's work; an unrelated fix you happened to make along the way stays untagged.`
    : "";

  return `Commit your work in this feature-branch worktree before finishing (Merge & Complete will squash later):
1. Stage only the files you touched — \`git add <file>\` or \`git add -u\`. NEVER \`git add -A\` (worktree contains a node_modules symlink that must stay untracked).
2. Write the subject as a short imperative description — no prefix, no conventional-commit type.${reference}
3. \`git status\` should show a clean tracked tree (untracked node_modules symlink is expected).`;
}

export type Phase = "planning" | "implementation" | "retest" | "verify";

export interface CardForPrompt {
  id: string;
  title: string;
  description: string;
  solutionSummary?: string | null;
  testScenarios?: string | null;
}

/** Detect which phase the card is in based on existing content. */
export function detectPhase(card: {
  solutionSummary: string | null;
  testScenarios: string | null;
  status?: string | null;
}): Phase {
  const hasSolution = card.solutionSummary && stripHtml(card.solutionSummary) !== "";
  const hasTests = card.testScenarios && stripHtml(card.testScenarios) !== "";

  if (!hasSolution) return "planning";
  if (!hasTests) return "implementation";
  // Human Test is a queue waiting on a person, and it is the column that grows
  // fastest because the agent finishes in minutes and verification takes days.
  // There the autonomous run walks the core flow rather than rewriting the
  // list, so what reaches the human is the handful of steps a machine could
  // not settle. Elsewhere a re-run still means "it broke, fix it".
  if (card.status === "test") return "verify";
  return "retest";
}

export function buildPhasePrompt(
  phase: Phase,
  card: CardForPrompt,
  displayId?: string | null,
  voice: Voice = DEFAULT_VOICE
): string {
  const title = stripHtml(card.title);
  const commitRef = displayId ?? null;
  const cardLanguage = detectCardLanguage({
    title: card.title,
    description: card.description,
  });

  switch (phase) {
    case "planning": {
      // The four headings and the two markers are the plan's contract with the
      // board (see RUN_OUTPUT_CONTRACTS.planning) — voice colours the prose
      // under them and nothing else.
      const planVoice = buildVoicePrompt(voice, "plan");
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

The four headings above and both markers are required in every voice — the voice below decides how the prose under them reads, not which sections exist:

${planVoice}

Plan only — do NOT implement. ${NO_SAVE_TOOLS_RULE}`;
    }

    case "implementation": {
      // buildVoicePrompt(..., "tests") returns the shared style contract with
      // the voice persona and its tests accent appended, so the manual-tester
      // format still wins and voice only colours the prose around each step.
      const styleContract = buildVoicePrompt(voice, "tests", { language: cardLanguage });
      return `Ideafy: ${card.id}

Read card via MCP (mcp__ideafy__get_card). Follow the approved plan in solutionSummary.

Task: Implement "${title}".

## After implementing — commit before outputting tests

${buildCommitInstructions(commitRef)}

Use multiple commits if changes are logically separate.

## FINAL response format

After committing, your FINAL response must be ONLY the manual test checklist — no preamble, no code summary, no file list.

The checklist opens with its core group: \`## Core flow\` on an English card, \`## Temel akış\` on a Turkish one. That heading is load-bearing, not decoration — the card reads it to know which items decide whether the feature works, so a checklist without it lands on the board unable to report its own progress. Everything below follows the style contract:

${styleContract}

${NO_SAVE_TOOLS_RULE}`;
    }

    case "retest": {
      // Retest authors a fresh checklist exactly like implementation does, so
      // it needs the same style contract. It went without one for as long as
      // it existed, which is why its output never carried a core group.
      const styleContract = buildVoicePrompt(voice, "tests", { language: cardLanguage });
      return `Ideafy: ${card.id}

Read card via MCP (mcp__ideafy__get_card). Review previous implementation and test scenarios.

Task: "${title}" failed during testing.

User will describe the error — wait, then fix. If you change code:

${buildCommitInstructions(commitRef)}

## FINAL response format

Your FINAL response must be ONLY the manual test checklist — no preamble, no code summary, no file list.

The checklist opens with its core group: \`## Core flow\` on an English card, \`## Temel akış\` on a Turkish one. That heading is load-bearing, not decoration — the card reads it to know which items decide whether the feature works, so a checklist without it lands on the board unable to report its own progress. Everything below follows the style contract:

${styleContract}

${NO_SAVE_TOOLS_RULE}`;
    }

    // Verify is the one phase that takes no voice: it reproduces an existing
    // checklist word for word, and a persona that rewords anything would turn
    // a verification pass into a silent rewrite.
    case "verify":
      return `Ideafy: ${card.id}

Read card via MCP (mcp__ideafy__get_card). The card is in Human Test: its checklist is waiting for a person to walk it.

Task: pre-verify the core flow of "${title}".

## What to run

Run ONLY the items under the checklist's first group — \`## Core flow\` (English) or \`## Temel akış\` (Turkish). Those are the steps that decide whether the feature works at all; everything after them exists to catch what they cannot, and stays for the human.

- Do NOT run, tick, or edit items in any later group (\`## Edge cases\`, \`## Regression\`, and so on).
- If the checklist has no \`## Core flow\` / \`## Temel akış\` group, tick nothing and say so — without that heading you cannot tell which items are essential, and guessing would hand back a checklist that looks verified and is not.
- Verify by actually exercising the code — read it, run it, run the build or the test the step names. Reasoning that a step "should" pass is not verification.

## FINAL response format

Reproduce the ENTIRE checklist: every group, every item, in the original order and wording. The only edit you may make is \`- [ ]\` → \`- [x]\` on core-flow items you ran and saw pass.

- Do not reword, merge, split, add, or drop items. Later groups come back exactly as they were.
- Leave a core item unticked when it failed or you could not run it.
- After the checklist, add one short line naming what blocked any core item you left unticked. Nothing else.

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
