/**
 * Prompt text for a pre-verify's automatic fix (IDE-459): the markers a
 * verify run leaves for the server, the re-verify that follows a fix, and the
 * fix run itself. Kept out of lib/prompts.ts, whose phase prompt is the file
 * the cloud repo diverges on; that file only splices these in.
 */

import type { FixTarget } from "../autonomous-run/verify-fix";

export const VERIFY_NO_CODE_CHANGES_RULE =
  "Do NOT change any code, config or test in this run, not even a one-character fix. You only diagnose; a separate run makes the fix and a third one checks it. A fix made here would be ticked by the same run that wrote it.";

/** The markers a pre-verify writes under its checklist for every item it left unticked. */
export const VERIFY_MARKERS_RULE = `- After the checklist, write one line for every target item you ran and left unticked, and nothing else. Each line is exactly one of:
  - \`[FIX] <item, word for word> :: <file:line> — <cause in one sentence>\` — ONLY when it is a plain code bug: the checklist or the card's plan states what should happen, the code clearly does something else, the cause sits in one place you can name, and a small change there would fix it.
  - \`[BLOCKED] <item, word for word> — <what stopped it>\` — everything else: it is unclear whether the expectation or the code is wrong, the fix needs a product decision, the environment or access is missing, or you could not run the step at all.
  - When in doubt, it is \`[BLOCKED]\`. A wrong \`[FIX]\` sends another run to change code that was right.`;

/** The re-verify after a fix: report, never diagnose again. */
export const REVERIFY_MARKERS_RULE = `- After the checklist, write one line per problem, and nothing else:
  - \`[REGRESSION] <item, word for word> — <what failed>\` for a ticked core-flow item you ran again and saw fail.
  - \`[BLOCKED] <item, word for word> — <what stopped it>\` for a fixed item that still fails or that you could not run.
  - Do not write \`[FIX]\` lines: an automatic fix gets one try, and what is left goes to the person.`;

export function buildReverifyWhatToRun(items: string[]): string {
  return `An automatic fix was just committed for the items below. Run each of them again, whatever group it sits in. They are your target items:
${items.map((item) => `- ${item}`).join("\n")}

Then check the fix broke nothing: run the already-ticked items under the checklist's first group (\`## Core flow\` / \`## Temel akış\`) again — but skip any step that should not run twice (migrations, \`--apply\` scripts, restarts, anything that writes data). Those stay ticked and untouched.

- Do NOT run, tick, or edit items in any other group.
- Never untick a box yourself; report a ticked item that now fails with a \`[REGRESSION]\` line and the server unticks it.`;
}

export interface VerifyFixPromptInput {
  cardId: string;
  title: string;
  displayId: string | null;
  inWorktree: boolean;
  targets: FixTarget[];
  /** Files this card's own work touched: the only ones the fix may change. */
  allowedFiles: string[];
  /** Files with someone else's uncommitted changes: never touched. */
  dirtyFiles: string[];
}

export function buildVerifyFixPrompt(input: VerifyFixPromptInput): string {
  const trailer = input.displayId
    ? ` Put the card trailer on its own line at the end: \`git commit -m "<short imperative description>" -m "Card: ${input.displayId}"\`.`
    : "";
  const where = input.inWorktree
    ? "This folder is the card's own branch worktree. Commit here and do not switch branches."
    : "Worktrees are off for this project, so this is the project folder on its current branch — usually main, which other sessions share. Do NOT create, switch, or check out a branch; commit where you are.";
  const dirty = input.dirtyFiles.length
    ? `\n## Never touch these files\nThey hold someone else's uncommitted changes:\n${input.dirtyFiles.map((f) => `- ${f}`).join("\n")}\n`
    : "";

  return `Ideafy: ${input.cardId}

Read card via MCP (mcp__ideafy__get_card) for the plan and the checklist. Do not change the card.

Task: fix the plain code bugs a pre-verify of "${input.title}" diagnosed, one commit per item.

${where}

## Diagnoses
${input.targets.map((t) => `- «${t.itemText}» — ${t.location}: ${t.cause}`).join("\n")}

## Rules
- Fix the code, never the expectation: do not change a test's assertion, a fixture's expected value, or the checklist to make something pass.
- Only change files this card's work already touched:
${input.allowedFiles.map((f) => `  - ${f}`).join("\n")}
- Keep each fix small and local. If one needs more than ~30 changed lines, a file outside that list, or turns out not to be the bug the diagnosis named, leave it: report it as NOT FIXED with the reason.
- Run the build, type check or test closest to the fix before you commit, and only commit a fix you saw work.
- Commit each fixed item on its own. Stage the files by name — \`git add <file>\`. NEVER \`git add -u\` or \`git add -A\`: they would sweep other work into your commit. Write the subject as a short imperative description, no prefix.${trailer}
- Leave no uncommitted changes behind. Undo what you tried for an item you did not fix.
${dirty}
## FINAL response format

\`\`\`
## Verify Fix Summary
FIXED <item, word for word> :: <short commit sha>
NOT FIXED <item, word for word> — <why>
\`\`\`

One line per diagnosed item, nothing else.

Do NOT call save_plan, save_tests, save_opinion, or any MCP save tools.

This is a one-shot \`claude -p\` run: never wait in the background (no Monitor, ScheduleWakeup or \`run_in_background\`), ask nobody anything, and shut down whatever you started before your final message.`;
}
