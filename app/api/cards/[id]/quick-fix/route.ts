import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { marked } from "marked";
import type { Status } from "@/lib/types";
import {
  stripHtml,
  convertToTipTapTaskList,
  buildQuickFixPrompt,
  saveCardImagesToTemp,
  generateImageReferences,
} from "@/lib/prompts";
import { getProcess, killProcess } from "@/lib/process-registry";
import { runAutonomousCli, completeProcess } from "@/lib/autonomous-run/run-autonomous-cli";
import {
  RUN_OUTPUT_CONTRACTS,
  splitQuickFixResponse,
  prependWarningHtml,
} from "@/lib/autonomous-run/select-run-output";
import { detectCardLanguage } from "@/lib/prompts/test-style";
import { isMissingDependencyError } from "@/lib/platform/base-provider";
import { getProviderForCard } from "@/lib/platform/active";
import {
  generateBranchName,
  isGitRepo,
  createWorktree,
  worktreeExists,
  getWorktreePath,
  git,
} from "@/lib/git";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Get the card from database
  const card = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();

  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  // Verify card is in bugs status
  if (card.status !== "bugs") {
    return NextResponse.json(
      { error: "Quick fix is only available for cards in Bugs column" },
      { status: 400 }
    );
  }

  // Get project for working directory
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
      { status: 400 }
    );
  }

  // Compute display ID for process tracking
  const displayId = project && card.taskNumber
    ? `${project.idPrefix}-${card.taskNumber}`
    : null;
  const processKey = `${id}-quick-fix`;

  console.log(`[Quick Fix] Starting quick fix for card ${id}`);
  console.log(`[Quick Fix] Working dir: ${workingDir}`);

  // Kill any existing process for this card
  const existing = getProcess(processKey);
  if (existing) {
    killProcess(processKey);
  }

  // Mark card as processing (persists through page refresh)
  db.update(schema.cards)
    .set({ processingType: "quick-fix" })
    .where(eq(schema.cards.id, id))
    .run();

  // Resolve worktree: per-card override wins, else project default (true).
  let gitBranchName = card.gitBranchName;
  let gitBranchStatus = card.gitBranchStatus;
  let gitWorktreePath = card.gitWorktreePath;
  let gitWorktreeStatus = card.gitWorktreeStatus;
  let actualWorkingDir = workingDir;

  const shouldUseWorktree = card.useWorktree ?? project?.useWorktrees ?? true;

  if (shouldUseWorktree && project && card.taskNumber) {
    const isRepo = await isGitRepo(workingDir);

    if (isRepo) {
      let branchName = card.gitBranchName;
      if (!branchName) {
        branchName = generateBranchName(
          project.idPrefix,
          card.taskNumber,
          card.title
        );
      }

      const expectedWorktreePath = getWorktreePath(workingDir, branchName);
      const worktreeExistsResult = await worktreeExists(workingDir, expectedWorktreePath);

      if (worktreeExistsResult) {
        console.log(`[Quick Fix] Using existing worktree: ${expectedWorktreePath}`);
        actualWorkingDir = expectedWorktreePath;
        gitWorktreePath = expectedWorktreePath;
        gitWorktreeStatus = "active";
        gitBranchName = branchName;
        gitBranchStatus = "active";
      } else {
        console.log(`[Quick Fix] Creating worktree for branch: ${branchName}`);
        const worktreeResult = await createWorktree(workingDir, branchName);

        if (worktreeResult.success) {
          actualWorkingDir = worktreeResult.worktreePath;
          gitWorktreePath = worktreeResult.worktreePath;
          gitWorktreeStatus = "active";
          gitBranchName = branchName;
          gitBranchStatus = "active";
          console.log(`[Quick Fix] Created worktree at: ${worktreeResult.worktreePath}`);
        } else {
          console.error(`[Quick Fix] Failed to create worktree: ${worktreeResult.error}`);
          db.update(schema.cards)
            .set({ processingType: null })
            .where(eq(schema.cards.id, id))
            .run();
          return NextResponse.json(
            { error: `Failed to create git worktree: ${worktreeResult.error}` },
            { status: 500 }
          );
        }
      }
    }
  } else if (!shouldUseWorktree) {
    console.log(`[Quick Fix] Working directly on main branch (worktrees disabled)`);
  }

  try {
    let prompt = buildQuickFixPrompt(card, project?.voice as never, getProviderForCard(card).id);

    // Extract and save images for CLI context
    const savedImages = saveCardImagesToTemp(card.id, card);
    const imageReferences = generateImageReferences(savedImages);
    if (imageReferences) {
      prompt = `${prompt}\n\n${imageReferences}`;
    }

    console.log(`[Quick Fix] Prompt length: ${prompt.length} chars`);

    const { response: responseText, warning, cost, duration } = await runAutonomousCli({
      prompt,
      cwd: actualWorkingDir,
      aiPlatform: card.aiPlatform,
      label: "Quick fix",
      timeoutMs: 10 * 60 * 1000,
      contract: RUN_OUTPUT_CONTRACTS.quickFix,
      tracking: {
        processKey,
        cardId: id,
        cardTitle: card.title,
        displayId,
        processType: "quick-fix",
      },
    });

    // Convert markdown response to HTML for TipTap editor
    const markedHtml = await marked(responseText);
    const htmlResponse = convertToTipTapTaskList(markedHtml);

    // Parse response to extract summary and tests. The core-flow heading is
    // the separator: one response carries both halves, and that heading is the
    // only one the checklist is guaranteed to open with. It used to split on
    // "## Test Scenarios", a wrapper the style contract never asked for — so
    // the checklist arrived without the core group the card needs to read it.
    const { summary: summaryText, checklist: checklistText } =
      splitQuickFixResponse(responseText);

    let solutionSummary = summaryText
      ? convertToTipTapTaskList(await marked(summaryText))
      : htmlResponse;
    if (warning) {
      solutionSummary = prependWarningHtml(solutionSummary, warning);
    }

    // Fallback for a response that carried no checklist at all. It still has to
    // open with a core heading, in the card's language — otherwise a parse miss
    // quietly writes the very card this fix exists to prevent.
    const fallbackChecklist =
      detectCardLanguage({ title: card.title, description: card.description }) === "tr"
        ? "## Temel akış\n- [ ] Bildirilen hatayı tekrar üretmeyi dene — artık oluşmamalı.\n- [ ] Hatanın çevresindeki akışı bir kez yürü, başka bir şeyin bozulmadığını gör."
        : "## Core flow\n- [ ] Try to reproduce the reported bug — it must no longer happen.\n- [ ] Walk the flow around it once and confirm nothing else broke.";

    const testScenarios = checklistText
      ? convertToTipTapTaskList(await marked(checklistText))
      : convertToTipTapTaskList(await marked(fallbackChecklist));

    // Auto-commit the changes
    const commitDisplayId = project
      ? `${project.idPrefix}-${card.taskNumber}`
      : `TASK-${card.taskNumber || "X"}`;

    const commitMessage = `fix(${commitDisplayId}): Quick fix - ${card.title}`;

    try {
      // Stage all changes
      await git(actualWorkingDir, "add", "-A");

      // Check if there are changes to commit
      const { stdout: status } = await git(actualWorkingDir, "status", "--porcelain");

      if (status.trim()) {
        // Commit the changes — commitMessage goes in as a literal argv element,
        // so $(), backticks, and quotes in card titles can't break out.
        await git(actualWorkingDir, "commit", "-m", commitMessage);
        console.log(`[Quick Fix] Auto-committed: ${commitMessage}`);
      } else {
        console.log(`[Quick Fix] No changes to commit`);
      }
    } catch (gitError) {
      console.error("[Quick Fix] Auto-commit failed:", gitError);
      // Commit fail olsa bile devam et - quick fix başarılı
    }

    // Update database - move to test status, clear processing flag
    const updatedAt = new Date().toISOString();
    const newStatus: Status = "test";

    db.update(schema.cards)
      .set({
        status: newStatus,
        solutionSummary,
        testScenarios,
        updatedAt,
        processingType: null,
        gitBranchName,
        gitBranchStatus,
        gitWorktreePath,
        gitWorktreeStatus,
      })
      .where(eq(schema.cards.id, id))
      .run();

    // Mark process as completed AFTER DB updates
    completeProcess(processKey);

    return NextResponse.json({
      success: true,
      cardId: id,
      newStatus,
      solutionSummary,
      testScenarios,
      outputWarning: warning,
      cost,
      duration,
      gitBranchName,
      gitBranchStatus,
      gitWorktreePath,
      gitWorktreeStatus,
    });
  } catch (error) {
    console.error("Quick Fix error:", error);
    // Clear processing flag on error
    db.update(schema.cards)
      .set({ processingType: null })
      .where(eq(schema.cards.id, id))
      .run();
    completeProcess(processKey);
    if (isMissingDependencyError(error)) {
      return NextResponse.json(
        { error: error.message, dependency: error.binaryName },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: "Failed to run quick fix",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
