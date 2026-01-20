import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exec } from "child_process";
import { promisify } from "util";
import { marked } from "marked";
import type { Status } from "@/lib/types";
import {
  stripHtml,
  convertToTipTapTaskList,
  escapeShellArg,
  buildQuickFixPrompt,
  saveCardImagesToTemp,
  generateImageReferences,
} from "@/lib/prompts";

const execAsync = promisify(exec);

interface ClaudeResponse {
  result?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  num_turns?: number;
  session_id?: string;
}

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

  console.log(`[Quick Fix] Starting quick fix for card ${id}`);
  console.log(`[Quick Fix] Working dir: ${workingDir}`);

  // Mark card as processing (persists through page refresh)
  db.update(schema.cards)
    .set({ processingType: "quick-fix" })
    .where(eq(schema.cards.id, id))
    .run();

  try {
    let prompt = buildQuickFixPrompt(card);

    // Extract and save images for CLI context
    const savedImages = saveCardImagesToTemp(card.id, card);
    const imageReferences = generateImageReferences(savedImages);
    if (imageReferences) {
      prompt = `${prompt}\n\n${imageReferences}`;
    }

    const escapedPrompt = escapeShellArg(prompt);

    // Quick fix uses --dangerously-skip-permissions for full access
    // No plan mode - direct implementation
    const command = `CI=true claude -p ${escapedPrompt} --dangerously-skip-permissions --output-format json < /dev/null`;

    console.log(`[Quick Fix] Prompt length: ${prompt.length} chars`);

    const { stdout, stderr } = await execAsync(command, {
      cwd: workingDir,
      timeout: 10 * 60 * 1000, // 10 minute timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    if (stderr) {
      console.log(`[Quick Fix] stderr: ${stderr}`);
    }

    let responseText = stdout.trim();
    let cost: number | undefined;
    let duration: number | undefined;

    try {
      const response: ClaudeResponse = JSON.parse(stdout);
      if (response.is_error) {
        throw new Error(response.result || "Claude returned an error");
      }
      responseText = response.result || "";
      cost = response.cost_usd;
      duration = response.duration_ms;
    } catch {
      console.log(`[Quick Fix] JSON parse failed, using raw output`);
    }

    // Convert markdown response to HTML for TipTap editor
    const markedHtml = await marked(responseText);
    const htmlResponse = convertToTipTapTaskList(markedHtml);

    // Parse response to extract summary and tests
    const summaryMatch = responseText.match(/## Quick Fix Summary[\s\S]*?(?=## Test Scenarios|$)/i);
    const testsMatch = responseText.match(/## Test Scenarios[\s\S]*/i);

    const solutionSummary = summaryMatch
      ? convertToTipTapTaskList(await marked(summaryMatch[0]))
      : htmlResponse;

    const testScenarios = testsMatch
      ? convertToTipTapTaskList(await marked(testsMatch[0]))
      : convertToTipTapTaskList(await marked("## Test Scenarios\n- [ ] Bug fix verified\n- [ ] No regression"));

    // Auto-commit the changes
    const displayId = project
      ? `${project.idPrefix}-${card.taskNumber}`
      : `TASK-${card.taskNumber || "X"}`;

    const commitMessage = `fix(${displayId}): Quick fix - ${card.title}`;

    try {
      // Stage all changes
      await execAsync("git add -A", { cwd: workingDir });

      // Check if there are changes to commit
      const { stdout: status } = await execAsync("git status --porcelain", {
        cwd: workingDir,
      });

      if (status.trim()) {
        // Commit the changes
        const escapedMsg = commitMessage.replace(/"/g, '\\"');
        await execAsync(`git commit -m "${escapedMsg}"`, { cwd: workingDir });
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
      })
      .where(eq(schema.cards.id, id))
      .run();

    return NextResponse.json({
      success: true,
      cardId: id,
      newStatus,
      solutionSummary,
      testScenarios,
      cost,
      duration,
    });
  } catch (error) {
    console.error("Quick Fix error:", error);
    // Clear processing flag on error
    db.update(schema.cards)
      .set({ processingType: null })
      .where(eq(schema.cards.id, id))
      .run();
    return NextResponse.json(
      {
        error: "Failed to run quick fix",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
