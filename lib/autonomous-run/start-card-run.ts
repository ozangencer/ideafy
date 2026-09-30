import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { linkCardsInHtml } from "@/lib/card-link-resolver";
import { marked } from "marked";
import type { Status } from "@/lib/types";
import {
  stripHtml,
  convertToTipTapTaskList,
  detectPhase,
  buildPhasePrompt,
  saveCardImagesToTemp,
  generateImageReferences,
  type Phase,
} from "@/lib/prompts";
import { normalizeProjectMode, normalizeVoice } from "@/lib/project-serialize";
import { runAutonomousCli, completeProcess } from "@/lib/autonomous-run/run-autonomous-cli";
import { getProcess } from "@/lib/process-registry";
import { describeRunError } from "@/lib/run-error";
import {
  ENDED_WHILE_WAITING_WARNING,
  RUN_OUTPUT_CONTRACTS,
  prependWarningHtml,
} from "@/lib/autonomous-run/select-run-output";
import { setupWorktree } from "@/lib/autonomous-run/setup-worktree";
import { autonomousRunTimeoutMs } from "@/lib/autonomous-run/run-timeout";
import { beginTrackedStart, dequeueCard, onRunFinished } from "@/lib/autonomous-run/run-queue";
import { assessTestRewrite } from "@/lib/markdown";

export interface StartCardRunResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

function getNewStatus(phase: Phase, currentStatus: Status): Status {
  switch (phase) {
    case "planning":
      return "progress";
    case "implementation":
      return "test";
    case "retest":
      return currentStatus; // Stay in current status.
    case "verify":
      return currentStatus; // Pre-verification does not move the card off Human Test.
  }
}

/**
 * One Start press, from the card row to the finished write-back: pick the
 * phase, set up the worktree, run the CLI, save what it produced.
 *
 * Lifted out of the Start route so the run queue can start a card with no
 * HTTP request behind it. The route turns the result into a response; the
 * queue ignores it and hears the outcome through onRunFinished.
 */
export async function startCardRun(cardId: string): Promise<StartCardRunResult> {
  const release = beginTrackedStart(cardId);
  try {
    return await runCardStart(cardId);
  } finally {
    release();
  }
}

async function runCardStart(id: string): Promise<StartCardRunResult> {
  const card = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();

  if (!card) {
    return { ok: false, status: 404, body: { error: "Card not found" } };
  }

  const project = card.projectId
    ? db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, card.projectId))
        .get()
    : null;

  const workingDir = project?.folderPath || card.projectFolder || process.cwd();

  if (!card.description || stripHtml(card.description) === "") {
    return { ok: false, status: 400, body: { error: "Card has no description to use as prompt" } };
  }

  // Starting a card takes it out of the run queue, whoever pressed Start: a
  // card run by hand has no business running a second time when its turn
  // comes. Before the first await, so an advance racing this one no longer
  // sees it queued.
  dequeueCard(id);

  // Detect current phase
  const phase = detectPhase(card);
  const promptDisplayId = project && card.taskNumber
    ? `${project.idPrefix}-${card.taskNumber}`
    : null;
  const newStatus = getNewStatus(phase, card.status as Status);

  console.log(`[Claude CLI] Phase: ${phase}`);
  console.log(`[Claude CLI] Current status: ${card.status} → New status: ${newStatus}`);

  const displayId = project && card.taskNumber
    ? `${project.idPrefix}-${card.taskNumber}`
    : null;
  const processKey = `${id}-autonomous`;

  // Mark card as processing (persists through page refresh).
  db.update(schema.cards)
    .set({ processingType: "autonomous" })
    .where(eq(schema.cards.id, id))
    .run();

  // Resolve working directory + branch/worktree metadata.
  const worktreeResult = await setupWorktree({
    workingDir,
    phase,
    project: project ?? null,
    card,
  });

  if (worktreeResult.error) {
    db.update(schema.cards)
      .set({ processingType: null })
      .where(eq(schema.cards.id, id))
      .run();
    const error = `Failed to create git worktree: ${worktreeResult.error}`;
    onRunFinished({ cardId: id, outcome: "failed", error });
    return { ok: false, status: 500, body: { error } };
  }

  const {
    actualWorkingDir,
    gitBranchName,
    gitBranchStatus,
    gitWorktreePath,
    gitWorktreeStatus,
  } = worktreeResult;

  // Record the branch the moment it exists, not when the run succeeds. A run
  // that crashes, is stopped or times out leaves the worktree on disk, and
  // work often carries on there by chat or terminal — a card that forgot its
  // branch then reaches Human Test with no Merge & Complete to offer (IDE-343).
  if (
    gitBranchName !== card.gitBranchName ||
    gitBranchStatus !== card.gitBranchStatus ||
    gitWorktreePath !== card.gitWorktreePath ||
    gitWorktreeStatus !== card.gitWorktreeStatus
  ) {
    db.update(schema.cards)
      .set({ gitBranchName, gitBranchStatus, gitWorktreePath, gitWorktreeStatus })
      .where(eq(schema.cards.id, id))
      .run();
  }

  // Built after setupWorktree so the commit instructions describe where the
  // run actually lands: a worktree only when setupWorktree moved the cwd into
  // one, otherwise the project folder on its current branch.
  let prompt = buildPhasePrompt(
    phase,
    card,
    promptDisplayId,
    normalizeVoice(project?.voice),
    actualWorkingDir !== workingDir,
    normalizeProjectMode(project?.mode),
  );

  // Extract and save images for CLI context
  const savedImages = saveCardImagesToTemp(card.id, card);
  const imageReferences = generateImageReferences(savedImages);
  if (imageReferences) {
    prompt = `${prompt}\n\n${imageReferences}`;
  }

  try {
    const result = await runAutonomousCli({
      prompt,
      cwd: actualWorkingDir,
      aiPlatform: card.aiPlatform,
      timeoutMs: autonomousRunTimeoutMs(phase, card.complexity),
      contract: RUN_OUTPUT_CONTRACTS[phase],
      tracking: {
        processKey,
        cardId: id,
        cardTitle: card.title,
        displayId,
        processType: "autonomous",
        runKind: phase,
      },
    });

    // Convert markdown response to HTML for the TipTap editor.
    const markedHtml = await marked(result.response);
    let htmlResponse = convertToTipTapTaskList(markedHtml);
    // A plan's Edge Cases names other cards as "IDE-318"; save them as [[ chips.
    if (phase === "planning") htmlResponse = linkCardsInHtml(htmlResponse, card.projectId);
    if (result.warning) {
      htmlResponse = prependWarningHtml(htmlResponse, result.warning);
    }

    // Planning phase can embed [COMPLEXITY:] / [PRIORITY:] — hoist them onto the card row.
    let complexity: string | null = null;
    let priority: string | null = null;
    if (phase === "planning") {
      const complexityMatch = result.response.match(/\[COMPLEXITY:\s*(trivial|low|medium|high|very_high)\]/i);
      if (complexityMatch) {
        complexity = complexityMatch[1].toLowerCase();
        console.log(`[Claude CLI] Extracted complexity: ${complexity}`);
      }

      const priorityMatch = result.response.match(/\[PRIORITY:\s*(low|medium|high)\]/i);
      if (priorityMatch) {
        priority = priorityMatch[1].toLowerCase();
        console.log(`[Claude CLI] Extracted priority: ${priority}`);
      }
    }

    const updates: Record<string, string | null> = {
      status: newStatus,
      updatedAt: new Date().toISOString(),
      gitBranchName,
      gitBranchStatus,
      gitWorktreePath,
      gitWorktreeStatus,
      processingType: null,
    };

    let verifyWarning: string | null = null;

    switch (phase) {
      case "planning":
        updates.solutionSummary = htmlResponse;
        if (complexity) updates.complexity = complexity;
        if (priority) updates.priority = priority;
        break;
      case "implementation":
        updates.testScenarios = htmlResponse;
        break;
      case "retest":
        updates.testScenarios = htmlResponse;
        break;
      case "verify": {
        // Verify is the one phase that must hand back a copy of the existing
        // checklist, so output that broke the contract is not a copy at all —
        // not even one long enough to pass the rewrite check below. A run that
        // stopped on a background wait (IDE-319) is named as such, since that
        // is the actual cause.
        if (result.endedWhileWaiting) {
          verifyWarning = `${ENDED_WHILE_WAITING_WARNING} — checklist left untouched`;
        } else if (result.warning) {
          verifyWarning = "Checklist left untouched — run output had no core-flow heading";
        } else {
          // A verify run is only allowed to tick boxes, so anything that comes
          // back materially shorter than what went in is a rewrite, not a
          // verification — and writing it would wipe the human's own ticks.
          const assessment = assessTestRewrite(card.testScenarios ?? "", htmlResponse);
          if (assessment.safe) {
            updates.testScenarios = htmlResponse;
          } else {
            verifyWarning = `Checklist left untouched — ${assessment.reason}`;
          }
        }
        if (verifyWarning) {
          console.warn(`[Claude CLI] verify rejected for ${id}: ${verifyWarning}`);
        }
        break;
      }
    }

    db.update(schema.cards)
      .set(updates)
      .where(eq(schema.cards.id, id))
      .run();

    const outputWarning = verifyWarning ?? result.warning;

    // Mark process as completed AFTER DB updates, so the UI stays in sync.
    // The warning rides along so the completion toast can say why the card
    // did not change instead of reporting a plain success.
    completeProcess(processKey, "completed", { warning: outputWarning });
    onRunFinished({ cardId: id, outcome: "completed" });

    return {
      ok: true,
      status: 200,
      body: {
        success: true,
        cardId: id,
        phase,
        newStatus,
        response: htmlResponse,
        outputWarning,
        complexity,
        priority,
        cost: result.cost,
        duration: result.duration,
        gitBranchName,
        gitBranchStatus,
        gitWorktreePath,
        gitWorktreeStatus,
      },
    };
  } catch (error) {
    console.error("Claude CLI error:", error);

    db.update(schema.cards)
      .set({ processingType: null })
      .where(eq(schema.cards.id, id))
      .run();
    // Stop goes through killProcess, which drops the registry entry; a
    // timeout kills the child but leaves the entry for completeProcess below.
    const stopped = !getProcess(processKey);
    const errorText = describeRunError(error);
    const pausedFor = onRunFinished({ cardId: id, outcome: stopped ? "stopped" : "failed", error: errorText });
    // Leading with the pause puts it in the banner and the bell's one-liner,
    // which is where you look when you come back to a queue that stopped.
    completeProcess(processKey, "failed", {
      error: pausedFor ? `Queue paused: ${pausedFor}\n${errorText}` : errorText,
    });

    // A Kill is not a failure: Background Processes already says "Process
    // Cancelled", and the button's failure toast would print the SIGTERM exit
    // (code 143) over the tail of the stream-json output.
    if (stopped) {
      return { ok: false, status: 499, body: { stopped: true, error: "Run stopped" } };
    }

    return {
      ok: false,
      status: 500,
      body: {
        error: "Failed to run Claude CLI",
        details: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
