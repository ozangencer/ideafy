import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
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
import { normalizeVoice } from "@/lib/project-serialize";
import { runAutonomousCli, completeProcess } from "@/lib/autonomous-run/run-autonomous-cli";
import {
  ENDED_WHILE_WAITING_WARNING,
  RUN_OUTPUT_CONTRACTS,
  prependWarningHtml,
} from "@/lib/autonomous-run/select-run-output";
import { setupWorktree } from "@/lib/autonomous-run/setup-worktree";
import { assessTestRewrite } from "@/lib/markdown";

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const card = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();

  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
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
    return NextResponse.json(
      { error: "Card has no description to use as prompt" },
      { status: 400 },
    );
  }

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
    return NextResponse.json(
      { error: `Failed to create git worktree: ${worktreeResult.error}` },
      { status: 500 },
    );
  }

  const {
    actualWorkingDir,
    gitBranchName,
    gitBranchStatus,
    gitWorktreePath,
    gitWorktreeStatus,
  } = worktreeResult;

  // Built after setupWorktree so the commit instructions describe where the
  // run actually lands: a worktree only when setupWorktree moved the cwd into
  // one, otherwise the project folder on its current branch.
  let prompt = buildPhasePrompt(
    phase,
    card,
    promptDisplayId,
    normalizeVoice(project?.voice),
    actualWorkingDir !== workingDir,
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
      contract: RUN_OUTPUT_CONTRACTS[phase],
      tracking: {
        processKey,
        cardId: id,
        cardTitle: card.title,
        displayId,
        processType: "autonomous",
      },
    });

    // Convert markdown response to HTML for the TipTap editor.
    const markedHtml = await marked(result.response);
    let htmlResponse = convertToTipTapTaskList(markedHtml);
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

    return NextResponse.json({
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
    });
  } catch (error) {
    console.error("Claude CLI error:", error);

    db.update(schema.cards)
      .set({ processingType: null })
      .where(eq(schema.cards.id, id))
      .run();
    completeProcess(processKey, "failed");

    return NextResponse.json(
      {
        error: "Failed to run Claude CLI",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
