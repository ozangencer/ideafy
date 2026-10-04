/**
 * Centralized prompt builders for Claude Code integration.
 * Most builders live under `@/lib/prompts/*` (see barrel re-exports below);
 * `buildPhasePrompt` and `buildConflictPrompt` stay in this file because the
 * phase prompt is what the solo and cloud repos diverge on, and keeping the
 * divergence on a single file keeps merges simple. `detectPhase` moved to
 * `./prompts/phase` so the run queue's shared rules (lib/card-ops/queue.ts)
 * can read it without pulling the prompt builders into the MCP bundle.
 */

// ------------------------------------------------------------------
// Re-exports (public API preserved)
// ------------------------------------------------------------------

export { stripHtml, convertToTipTapTaskList, escapeShellArg } from "./prompts/utils";
export { type Phase, detectPhase } from "./prompts/phase";
export {
  type SavedImage,
  saveCardImagesToTemp,
  extractConversationImages,
  generateImageReferences,
  getCardImageDir,
} from "./prompts/images";
export {
  buildEvaluatePrompt,
  buildQuickFixPrompt,
  buildGeneratePrompt,
  buildIdeationPrompt,
} from "./prompts/card";
export { buildTestTogetherPrompt, buildTestGenerationPrompt } from "./prompts/testing";
export {
  type NarrativeData,
  buildNarrativePrompt,
  generateFallbackContent,
  type WorkBriefData,
  buildWorkBriefPrompt,
  generateWorkBriefFallback,
} from "./prompts/narrative";

// ------------------------------------------------------------------
// Phase prompt (kept in place because cloud customises this prompt's body)
// ------------------------------------------------------------------

import { stripHtml } from "./prompts/utils";
import type { Phase } from "./prompts/phase";
import { detectCardLanguage } from "./prompts/test-style";
import { buildVoicePrompt } from "./prompts/voice-style";
import { AI_OPINION_PLANNING_RULE } from "./prompts/opinion";
import { CHAIN_IMPLEMENTATION_RULE, PRIOR_DECISIONS_RULE } from "./prompts/prior-decisions";
import { DEFAULT_VOICE, type ProjectMode, type Voice } from "./types";
import type { VerifyScope } from "./test-progress";
import {
  REVERIFY_MARKERS_RULE,
  VERIFY_MARKERS_RULE,
  VERIFY_NO_CODE_CHANGES_RULE,
  buildReverifyWhatToRun,
} from "./prompts/verify-fix";

/**
 * What a pre-verify run walks, worked out from the card's checklist the moment
 * the run starts, so items ticked while it waited in the queue are not run
 * again. `groups` are the target groups as the prompt names them, in order;
 * `core` says the only target is the core flow.
 */
export interface VerifyTarget {
  scope: VerifyScope;
  groups: string[];
  core: boolean;
  /**
   * Re-verify after an automatic fix (IDE-459): the fixed items, run again
   * whatever group they sit in, plus the core flow's safe-to-repeat steps as
   * a regression check. `groups` and `core` are ignored when set.
   */
  items?: string[];
}

const NO_SAVE_TOOLS_RULE =
  "Do NOT call save_plan, save_tests, save_opinion, or any MCP save tools — output your response as text; it is auto-saved to the card.";

// Every phase runs as `claude -p`: the process exits the moment the last
// message is written, and nothing ever wakes it again. A run that parked itself
// on Monitor/ScheduleWakeup ended on "a notification will arrive" and wrote
// nothing to the card (IDE-319). The CLI denies the wait tools outright;
// `run_in_background` can't be denied by name, so this rule carries it.
const ONE_SHOT_RUN_RULE = `## This is a one-shot run

This run is a single \`claude -p\` invocation: the process exits as soon as your last message is written, and nothing will ever resume it.
- Never wait in the background — no Monitor, no ScheduleWakeup, no \`run_in_background\` on Bash, no "I'll continue when the notification arrives". If you need to wait for something (a dev server, a build, an AI response), wait for it in the foreground within this run.
- If a step would take too long to wait for, leave it unfinished and say why in your final message.
- Do not ask the user anything — no one is there to answer. Decide when you can; when you can't, leave the related item open and write next to it what you would have asked.
- Before your final message, shut down whatever you started during this run: dev servers, ports, and any extra git worktrees you created. Leave the directory this run was started in alone.`;

function buildCommitInstructions(commitRef: string | null, inWorktree: boolean): string {
  // The card reference is a trailer rather than a subject prefix so the subject
  // stays the plain sentence it would have been. Without a resolvable display
  // ID there is nothing worth referencing — a UUID fragment reads like a ref
  // while matching no card at all — so that case just gets a normal commit.
  const reference = commitRef
    ? ` Reference the card with a trailer on its own line at the end of the message: \`git commit -m "<short imperative description>" -m "Card: ${commitRef}"\`. Add the trailer only when the commit advances this card's work; an unrelated fix you happened to make along the way stays untagged.`
    : "";
  const subject = `Write the subject as a short imperative description — no prefix, no conventional-commit type.${reference}`;

  if (inWorktree) {
    return `Commit your work in this feature-branch worktree before finishing (Merge & Complete will squash later):
1. Stage only the files you touched — \`git add <file>\` or \`git add -u\`. NEVER \`git add -A\` (worktree contains a node_modules symlink that must stay untracked).
2. ${subject}
3. \`git status\` should show a clean tracked tree (untracked node_modules symlink is expected).`;
  }

  // Flow mode: the project has worktrees switched off and the run starts in
  // the project folder on whatever branch it is on — usually main. Telling the
  // agent it is in a feature-branch worktree made it "fix" the mismatch with
  // its own `git checkout -b`, so this variant says outright not to.
  return `Commit your work on the branch this session started on before finishing. Worktrees are off for this project (flow mode), so there is no feature branch:
1. Do NOT create, switch, or check out a branch — commit on the current branch, even when it is main.
2. Stage only the files you touched — \`git add <file>\` or \`git add -u\`. NEVER \`git add -A\`.
3. ${subject}
4. \`git status\` should show a clean tracked tree.`;
}

export interface CardForPrompt {
  id: string;
  title: string;
  description: string;
  solutionSummary?: string | null;
  testScenarios?: string | null;
}

export function buildPhasePrompt(
  phase: Phase,
  card: CardForPrompt,
  displayId?: string | null,
  voice: Voice = DEFAULT_VOICE,
  // Whether the run's cwd is a feature-branch worktree. Defaults to false:
  // flow-mode wording ("commit where you are") is harmless inside a worktree,
  // while worktree wording on main is what sent an agent off to branch itself.
  inWorktree = false,
  // The card's project mode. Work only reaches planning and verify (it has no
  // implementation run), so those two phases and the voice are what change.
  mode: ProjectMode = "development",
  // Verify only: which groups this run walks. Omitted, it walks the core flow.
  verifyTarget?: VerifyTarget
): string {
  const isWork = mode === "work";
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
      const planVoice = buildVoicePrompt(voice, "plan", { mode });
      // Only the two markers are the board's contract; the headings are there
      // to shape the plan, and a Work card has no files to modify.
      const planHeadings = isWork
        ? `- Output (what gets produced and the name it is saved under in the project folder)
- Steps
- Sources and Inputs
- Open Questions`
        : `- Files to Modify
- Implementation Steps
- Edge Cases
- Dependencies`;
      return `Ideafy: ${card.id}

Read card via MCP (mcp__ideafy__get_card). Review title, description, and any existing notes.

${AI_OPINION_PLANNING_RULE}

${PRIOR_DECISIONS_RULE}

Task: Create ${isWork ? "a work plan" : "implementation plan"} for "${title}".

Plan format:
${planHeadings}

Must include at the end:
[COMPLEXITY: trivial/low/medium/high/very_high]
[PRIORITY: low/medium/high]

The four headings above and both markers are required in every voice — the voice below decides how the prose under them reads, not which sections exist:

${planVoice}

Plan only — do NOT implement. ${NO_SAVE_TOOLS_RULE}

${ONE_SHOT_RUN_RULE}`;
    }

    case "implementation": {
      // buildVoicePrompt(..., "tests") returns the shared style contract with
      // the voice persona and its tests accent appended, so the manual-tester
      // format still wins and voice only colours the prose around each step.
      const styleContract = buildVoicePrompt(voice, "tests", { language: cardLanguage, mode });
      return `Ideafy: ${card.id}

Read card via MCP (mcp__ideafy__get_card). Follow the approved plan in solutionSummary.

${CHAIN_IMPLEMENTATION_RULE}

Task: Implement "${title}".

## After implementing — commit before outputting tests

${buildCommitInstructions(commitRef, inWorktree)}

Use multiple commits if changes are logically separate.

## FINAL response format

After committing, your FINAL response must be ONLY the manual test checklist — no preamble, no code summary, no file list.

The checklist opens with its core group: \`## Core flow\` on an English card, \`## Temel akış\` on a Turkish one. That heading is load-bearing, not decoration — the card reads it to know which items decide whether the feature works, so a checklist without it lands on the board unable to report its own progress. Everything below follows the style contract:

${styleContract}

${NO_SAVE_TOOLS_RULE}

${ONE_SHOT_RUN_RULE}`;
    }

    case "retest": {
      // Retest authors a fresh checklist exactly like implementation does, so
      // it needs the same style contract. It went without one for as long as
      // it existed, which is why its output never carried a core group.
      const styleContract = buildVoicePrompt(voice, "tests", { language: cardLanguage, mode });
      return `Ideafy: ${card.id}

Read card via MCP (mcp__ideafy__get_card). Review previous implementation and test scenarios.

${CHAIN_IMPLEMENTATION_RULE}

Task: "${title}" failed during testing.

User will describe the error — wait, then fix. If you change code:

${buildCommitInstructions(commitRef, inWorktree)}

## FINAL response format

Your FINAL response must be ONLY the manual test checklist — no preamble, no code summary, no file list.

The checklist opens with its core group: \`## Core flow\` on an English card, \`## Temel akış\` on a Turkish one. That heading is load-bearing, not decoration — the card reads it to know which items decide whether the feature works, so a checklist without it lands on the board unable to report its own progress. Everything below follows the style contract:

${styleContract}

${NO_SAVE_TOOLS_RULE}

${ONE_SHOT_RUN_RULE}`;
    }

    // Verify is the one phase that takes no voice: it reproduces an existing
    // checklist word for word, and a persona that rewords anything would turn
    // a verification pass into a silent rewrite.
    case "verify": {
      const target = verifyTarget ?? { scope: "next" as const, groups: [], core: true };
      const onlyCore = target.core || target.groups.length === 0;
      const reverifyItems = !isWork && target.items?.length ? target.items : null;
      const task = reverifyItems
        ? `re-verify "${title}" after an automatic fix`
        : onlyCore
        ? `pre-verify the core flow of "${title}"`
        : target.groups.length === 1
          ? `pre-verify the ${target.groups[0]} group of "${title}"`
          : `pre-verify the groups of "${title}" that still have unticked items`;
      const whatToRun = reverifyItems
        ? buildReverifyWhatToRun(reverifyItems)
        : onlyCore
        ? `Run ONLY the items under the checklist's first group — \`## Core flow\` (English) or \`## Temel akış\` (Turkish). Those are the steps that decide whether the feature works at all; everything after them exists to catch what they cannot, and stays for the human. Those core items are your target items.

- Do NOT run, tick, or edit items in any later group (\`## Edge cases\`, \`## Regression\`, and so on).`
        : target.groups.length === 1
          ? `Run ONLY the items under ${target.groups[0]}. Those are your target items: the core flow has already passed, and the person asked for this group next.

- Do NOT run, tick, or edit items in any other group — not the core flow, not the groups before or after this one.`
          : `Run the items under each of these groups, in this order: ${target.groups.join(", ")}. Their items are your target items: the person asked for every group that still has unticked items in one run.

- Do NOT run, tick, or edit items in any group that is not in that list.`;
      return `Ideafy: ${card.id}

Read card via MCP (mcp__ideafy__get_card). The card is in ${isWork ? "In Review" : "Human Test"}: its checklist is waiting for a person to walk it.

Task: ${task}.
${inWorktree && !isWork ? "\nThis folder is the card's own branch worktree, where its changes were written. Run everything here and do not switch branches.\n" : ""}
## What to run

${whatToRun}
${reverifyItems ? "" : `- Skip target items that are already ticked (\`- [x]\`): a person or an earlier pre-verify has already seen them pass, and some steps (migrations, \`--apply\` scripts, restarts) should not run twice. Leave them ticked and run only the unticked ones. If every target item is already ticked, run nothing and hand the checklist back unchanged.
`}- If the checklist has no \`## Core flow\` / \`## Temel akış\` group, tick nothing and say so — without that heading you cannot tell which items are essential, and guessing would hand back a checklist that looks verified and is not.
- ${isWork
  ? "Verify by actually checking the output — open the file the step names in the project folder (get_card lists them as outputPaths) and confirm what the step asks. Reasoning that a step \"should\" pass is not verification."
  : "Verify by actually exercising the code — read it, run it, run the build or the test the step names. Reasoning that a step \"should\" pass is not verification."}
${isWork ? "" : `- ${VERIFY_NO_CODE_CHANGES_RULE}
`}
## FINAL response format

Reproduce the ENTIRE checklist: every group, every item, in the original order and wording. The only edit you may make is \`- [ ]\` → \`- [x]\` on target items you ran and saw pass.

- Do not reword, merge, split, add, or drop items. Every group you were not asked to run comes back exactly as it was.
- Leave a target item unticked when it failed or you could not run it.
${isWork
  ? "- After the checklist, add one short line naming what blocked any target item you ran and left unticked. Nothing else.\n"
  : reverifyItems
    ? `${REVERIFY_MARKERS_RULE}\n`
    : `${VERIFY_MARKERS_RULE}\n`}- Your final message is always the checklist itself — even when you could not finish a single item. A message that only says what you are still waiting for leaves the card untouched.

${NO_SAVE_TOOLS_RULE}

${ONE_SHOT_RUN_RULE}`;
    }
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
