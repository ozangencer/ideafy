import { eq } from "drizzle-orm";
import { marked } from "marked";
import { db, schema } from "@/lib/db";
import { git, getDefaultBranch } from "@/lib/git";
import { buildPhasePrompt, convertToTipTapTaskList, type CardForPrompt } from "@/lib/prompts";
import { buildVerifyFixPrompt } from "@/lib/prompts/verify-fix";
import { getProcess } from "@/lib/process-registry";
import { describeRunError } from "@/lib/run-error";
import {
  assessTestRewrite,
  closestTaskText,
  matchTaskItem,
  mergeTestCheckState,
  untickTaskItems,
} from "@/lib/markdown";
import type { ProcessingType, ProjectMode, Voice } from "@/lib/types";
import { runAutonomousCli, completeProcess } from "./run-autonomous-cli";
import { RUN_OUTPUT_CONTRACTS } from "./select-run-output";
import { autonomousRunLimits } from "./run-timeout";
import {
  checkFixCommits,
  parseCommitLog,
  parseFixSummary,
  parsePorcelainPaths,
  resolveFixOutcomes,
  screenFixTargets,
  splitVerifyMarkers,
  REASON_GIT,
  REASON_STOPPED,
  type FixNote,
  type FixTarget,
} from "./verify-fix";

/**
 * A pre-verify's automatic fix (IDE-459), run after the verify itself has
 * written its checklist: one run fixes the plain code bugs it diagnosed, a
 * second one — which did not write the fix — runs those items again and
 * ticks what passes. One try per item; what is left goes to the person.
 *
 * Runs inside the same Start as the verify, so the run queue sees the whole
 * chain as one run and nothing else starts in between.
 */

export interface VerifyFixChainInput {
  card: CardForPrompt & { aiPlatform?: string | null };
  displayId: string | null;
  voice: Voice;
  mode: ProjectMode;
  cwd: string;
  inWorktree: boolean;
  processKey: string;
  targets: FixTarget[];
}

export interface VerifyFixChainResult {
  notes: FixNote[];
  /** Why the chain did not get to the end, for the completion toast. */
  warning: string | null;
  /** The person pressed Stop during one of the chain's runs. */
  stopped: boolean;
}

function setProcessing(cardId: string, processingType: ProcessingType): void {
  db.update(schema.cards).set({ processingType }).where(eq(schema.cards.id, cardId)).run();
}

function currentTestScenarios(cardId: string): string {
  return (
    db
      .select({ testScenarios: schema.cards.testScenarios })
      .from(schema.cards)
      .where(eq(schema.cards.id, cardId))
      .get()?.testScenarios ?? ""
  );
}

async function gitOut(cwd: string, ...args: string[]): Promise<string> {
  return (await git(cwd, ...args)).stdout;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The files this card's own work touched: its branch's diff in a worktree,
 * otherwise every commit that carries its `Card:` trailer. Empty when neither
 * says — and then no fix runs, since there is nothing to keep it inside.
 */
async function cardFiles(cwd: string, inWorktree: boolean, displayId: string | null): Promise<string[]> {
  let out = "";
  if (inWorktree) {
    const base = (await gitOut(cwd, "merge-base", await getDefaultBranch(cwd), "HEAD")).trim();
    out = await gitOut(cwd, "diff", "--name-only", base, "HEAD");
  } else if (displayId) {
    out = await gitOut(
      cwd,
      "log",
      "--extended-regexp",
      `--grep=^Card: ${escapeRegex(displayId)}$`,
      "--name-only",
      "--format="
    );
  }
  return Array.from(new Set(out.split("\n").map((l) => l.trim()).filter(Boolean)));
}

export async function runVerifyFixChain(input: VerifyFixChainInput): Promise<VerifyFixChainResult> {
  const { card, cwd, processKey } = input;
  const notes: FixNote[] = [];

  // --- Before: where HEAD is, whose changes are lying around, what is ours.
  let baseSha: string;
  let dirtyBefore: string[];
  let ownFiles: string[];
  try {
    baseSha = (await gitOut(cwd, "rev-parse", "HEAD")).trim();
    dirtyBefore = parsePorcelainPaths(await gitOut(cwd, "status", "--porcelain"));
    ownFiles = await cardFiles(cwd, input.inWorktree, input.displayId);
  } catch (error) {
    console.warn(`[verify-fix] ${card.id}: git state unreadable, no fix run`, error);
    for (const target of input.targets) {
      notes.push({ kind: "not-fixed", item: target.itemText, reason: REASON_GIT });
    }
    return { notes, warning: "Automatic fix skipped — could not read the git state", stopped: false };
  }

  const screened = screenFixTargets({
    targets: input.targets,
    repoRoot: cwd,
    dirtyFiles: dirtyBefore,
    cardFiles: ownFiles,
  });
  for (const { target, reason, file } of screened.skipped) {
    notes.push({ kind: "skipped", item: target.itemText, reason, file });
  }
  if (screened.eligible.length === 0) return { notes, warning: null, stopped: false };

  // --- The fix run. processingType tells the run queue this step writes code.
  setProcessing(card.id, "verify-fix");
  const fixLimits = autonomousRunLimits("verify-fix", null);
  let fixResponse = "";
  let fixFailure: string | null = null;
  try {
    const result = await runAutonomousCli({
      prompt: buildVerifyFixPrompt({
        cardId: card.id,
        title: card.title,
        displayId: input.displayId,
        inWorktree: input.inWorktree,
        targets: screened.eligible,
        allowedFiles: ownFiles,
        dirtyFiles: dirtyBefore,
      }),
      cwd,
      aiPlatform: card.aiPlatform,
      timeoutMs: fixLimits.hardMs,
      idleTimeoutMs: fixLimits.idleMs,
      contract: RUN_OUTPUT_CONTRACTS.verifyFix,
      tracking: {
        processKey,
        cardId: card.id,
        cardTitle: card.title,
        displayId: input.displayId,
        processType: "autonomous",
        runKind: "verify-fix",
        phase: "verify-fix",
        targetColumn: null,
      },
    });
    fixResponse = result.response;
    completeProcess(processKey, "completed", { warning: result.warning });
  } catch (error) {
    if (!getProcess(processKey)) {
      setProcessing(card.id, "autonomous");
      for (const target of screened.eligible) {
        notes.push({ kind: "not-fixed", item: target.itemText, reason: REASON_STOPPED });
      }
      // What a stopped run already committed is still reported below.
      return { notes: [...notes, ...(await afterFix(cwd, baseSha, dirtyBefore, ownFiles))], warning: null, stopped: true };
    }
    fixFailure = describeRunError(error);
    completeProcess(processKey, "failed", { error: fixFailure });
  }
  setProcessing(card.id, "autonomous");

  // --- After: what git holds, checked against the rules the prompt gave.
  let commits;
  let leftover: string[];
  try {
    commits = parseCommitLog(await gitOut(cwd, "log", `${baseSha}..HEAD`, "--name-only", "--format=%x00%h"));
    leftover = parsePorcelainPaths(await gitOut(cwd, "status", "--porcelain")).filter(
      (file) => !dirtyBefore.includes(file)
    );
  } catch (error) {
    console.warn(`[verify-fix] ${card.id}: git state unreadable after the fix`, error);
    return { notes, warning: "Automatic fix ran, but its commits could not be read", stopped: false };
  }
  const violations = checkFixCommits({ commits, dirtyBefore, cardFiles: ownFiles });
  const resolution = resolveFixOutcomes({
    targets: screened.eligible,
    outcomes: fixFailure ? [] : parseFixSummary(fixResponse),
    commits,
    violations,
  });
  notes.push(...resolution.notes);
  if (leftover.length > 0) notes.push({ kind: "leftover", files: leftover });
  if (fixFailure) {
    return { notes, warning: `Automatic fix failed: ${fixFailure}`, stopped: false };
  }
  if (resolution.committed.length === 0) return { notes, warning: null, stopped: false };

  // --- The re-verify: a run that did not write the fix ticks what passes.
  const before = currentTestScenarios(card.id);
  const items = resolution.committed.map((c) => c.target.itemText);
  const reverifyLimits = autonomousRunLimits("verify", null);
  const unverified = (reason: string): FixNote[] =>
    resolution.committed.map((c) => ({ kind: "unverified", item: c.target.itemText, sha: c.sha, reason }));
  let reverifyResponse: string;
  let reverifyWarning: string | null;
  let endedWhileWaiting: boolean;
  try {
    const result = await runAutonomousCli({
      prompt: buildPhasePrompt(
        "verify",
        { ...card, testScenarios: before },
        input.displayId,
        input.voice,
        input.inWorktree,
        input.mode,
        { scope: "next", groups: [], core: true, items }
      ),
      cwd,
      aiPlatform: card.aiPlatform,
      timeoutMs: reverifyLimits.hardMs,
      idleTimeoutMs: reverifyLimits.idleMs,
      contract: RUN_OUTPUT_CONTRACTS.verify,
      tracking: {
        processKey,
        cardId: card.id,
        cardTitle: card.title,
        displayId: input.displayId,
        processType: "autonomous",
        runKind: "reverify",
        phase: "reverify",
        targetColumn: null,
      },
    });
    reverifyResponse = result.response;
    reverifyWarning = result.warning;
    endedWhileWaiting = result.endedWhileWaiting;
  } catch (error) {
    if (!getProcess(processKey)) {
      return { notes: [...notes, ...unverified(REASON_STOPPED)], warning: null, stopped: true };
    }
    const failure = describeRunError(error);
    completeProcess(processKey, "failed", { error: failure });
    return { notes: [...notes, ...unverified("")], warning: `Re-verify failed: ${failure}`, stopped: false };
  }

  if (endedWhileWaiting || reverifyWarning) {
    const why = endedWhileWaiting ? "ended while waiting" : "no core-flow heading";
    completeProcess(processKey, "completed", { warning: `Checklist left untouched — ${why}` });
    return { notes: [...notes, ...unverified("")], warning: `Re-verify left the checklist untouched — ${why}`, stopped: false };
  }

  const markers = splitVerifyMarkers(reverifyResponse);
  const html = convertToTipTapTaskList(await marked(markers.checklist));
  const now = currentTestScenarios(card.id);
  const assessment = assessTestRewrite(now, html);
  if (!assessment.safe) {
    completeProcess(processKey, "completed", { warning: `Checklist left untouched — ${assessment.reason}` });
    return {
      notes: [...notes, ...unverified("")],
      warning: `Re-verify left the checklist untouched — ${assessment.reason}`,
      stopped: false,
    };
  }
  // Ticks from either side stay, as for any verify — except an item the
  // re-verify saw break after the fix: that one is the point of running it.
  let merged = mergeTestCheckState(now, html);
  merged = untickTaskItems(merged, markers.regressions.map((r) => r.item));
  db.update(schema.cards)
    .set({ testScenarios: merged, updatedAt: new Date().toISOString() })
    .where(eq(schema.cards.id, card.id))
    .run();
  completeProcess(processKey, "completed");

  for (const { target, sha } of resolution.committed) {
    const passed = matchTaskItem(target.itemText, merged)?.checked === true;
    notes.push({ kind: passed ? "verified" : "still-failing", item: target.itemText, sha });
  }
  for (const regression of markers.regressions) {
    // A fixed item named here already reads "did not pass" above.
    if (closestTaskText(regression.item, items) !== -1) continue;
    notes.push({ kind: "regression", item: regression.item, reason: regression.reason });
  }
  return { notes, warning: null, stopped: false };
}

/** Violations and leftovers of a fix run that was stopped part way. */
async function afterFix(
  cwd: string,
  baseSha: string,
  dirtyBefore: string[],
  ownFiles: string[]
): Promise<FixNote[]> {
  try {
    const commits = parseCommitLog(await gitOut(cwd, "log", `${baseSha}..HEAD`, "--name-only", "--format=%x00%h"));
    const leftover = parsePorcelainPaths(await gitOut(cwd, "status", "--porcelain")).filter(
      (file) => !dirtyBefore.includes(file)
    );
    const notes: FixNote[] = checkFixCommits({ commits, dirtyBefore, cardFiles: ownFiles }).map((v) => ({
      kind: "violation",
      sha: v.sha,
      files: v.files,
    }));
    if (leftover.length > 0) notes.push({ kind: "leftover", files: leftover });
    return notes;
  } catch {
    return [];
  }
}
