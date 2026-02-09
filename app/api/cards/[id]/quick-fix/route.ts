import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { spawn, exec } from "child_process";
import { promisify } from "util";
import { marked } from "marked";
import type { Status } from "@/lib/types";
import {
  stripHtml,
  convertToTipTapTaskList,
  buildQuickFixPrompt,
  saveCardImagesToTemp,
  generateImageReferences,
} from "@/lib/prompts";
import {
  registerProcess,
  completeProcess,
  getProcess,
  killProcess,
} from "@/lib/process-registry";
import { getActiveProvider } from "@/lib/platform/active";

const execAsync = promisify(exec);

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

  try {
    let prompt = buildQuickFixPrompt(card);

    // Extract and save images for CLI context
    const savedImages = saveCardImagesToTemp(card.id, card);
    const imageReferences = generateImageReferences(savedImages);
    if (imageReferences) {
      prompt = `${prompt}\n\n${imageReferences}`;
    }

    console.log(`[Quick Fix] Prompt length: ${prompt.length} chars`);

    const provider = getActiveProvider();

    // Run CLI with spawn for process tracking
    const { responseText, cost, duration } = await new Promise<{
      responseText: string;
      cost?: number;
      duration?: number;
    }>((resolve, reject) => {
      const cliProcess = spawn(provider.getCliPath(), provider.buildAutonomousArgs({ prompt }), {
        cwd: workingDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: provider.getCIEnv(),
      });

      // Close stdin immediately
      cliProcess.stdin?.end();

      // Register process for tracking
      registerProcess(processKey, cliProcess, {
        cardId: id,
        sectionType: null,
        processType: "quick-fix",
        cardTitle: card.title,
        displayId,
        startedAt: new Date().toISOString(),
      });

      let stdout = "";
      let stderr = "";

      cliProcess.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      cliProcess.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      // Set timeout
      const timeout = setTimeout(() => {
        cliProcess.kill();
        reject(new Error("Quick fix timed out after 10 minutes"));
      }, 10 * 60 * 1000);

      cliProcess.on("close", (code) => {
        clearTimeout(timeout);

        if (stderr) {
          console.log(`[Quick Fix] stderr: ${stderr}`);
        }

        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`${provider.displayName} exited with code ${code}: ${stderr}`));
          return;
        }

        const parsed = provider.parseJsonResponse(stdout);
        if (parsed.isError) {
          reject(new Error(parsed.result || `${provider.displayName} returned an error`));
          return;
        }
        resolve({
          responseText: parsed.result,
          cost: parsed.cost,
          duration: parsed.duration,
        });
      });

      cliProcess.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

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
    const commitDisplayId = project
      ? `${project.idPrefix}-${card.taskNumber}`
      : `TASK-${card.taskNumber || "X"}`;

    const commitMessage = `fix(${commitDisplayId}): Quick fix - ${card.title}`;

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

    // Mark process as completed AFTER DB updates
    completeProcess(processKey);

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
    completeProcess(processKey);
    return NextResponse.json(
      {
        error: "Failed to run quick fix",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
