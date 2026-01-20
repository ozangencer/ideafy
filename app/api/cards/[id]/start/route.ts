import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exec } from "child_process";
import { promisify } from "util";
import { marked } from "marked";
import type { Status } from "@/lib/types";
import {
  generateBranchName,
  isGitRepo,
  branchExists,
  createWorktree,
  worktreeExists,
  getWorktreePath,
} from "@/lib/git";
import {
  stripHtml,
  convertToTipTapTaskList,
  escapeShellArg,
  detectPhase,
  buildPhasePrompt,
  saveCardImagesToTemp,
  generateImageReferences,
  type Phase,
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

function getNewStatus(phase: Phase, currentStatus: Status): Status {
  switch (phase) {
    case "planning":
      return "progress";
    case "implementation":
      return "test";
    case "retest":
      return currentStatus; // Stay in current status
  }
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

  // Detect current phase
  const phase = detectPhase(card);
  let prompt = buildPhasePrompt(phase, card);
  const newStatus = getNewStatus(phase, card.status as Status);

  // Extract and save images for CLI context
  const savedImages = saveCardImagesToTemp(card.id, card);
  const imageReferences = generateImageReferences(savedImages);
  if (imageReferences) {
    prompt = `${prompt}\n\n${imageReferences}`;
  }

  console.log(`[Claude CLI] Phase: ${phase}`);
  console.log(`[Claude CLI] Current status: ${card.status} → New status: ${newStatus}`);

  // Mark card as processing (persists through page refresh)
  db.update(schema.cards)
    .set({ processingType: "autonomous" })
    .where(eq(schema.cards.id, id))
    .run();

  // Handle git branch and worktree for implementation phase
  let gitBranchName = card.gitBranchName;
  let gitBranchStatus = card.gitBranchStatus;
  let gitWorktreePath = card.gitWorktreePath;
  let gitWorktreeStatus = card.gitWorktreeStatus;
  let actualWorkingDir = workingDir;

  // Only use worktrees if project has it enabled (default: true)
  const shouldUseWorktree = project?.useWorktrees ?? true;

  if (phase === "implementation" && project && card.taskNumber && shouldUseWorktree) {
    const isRepo = await isGitRepo(workingDir);

    if (isRepo) {
      // Determine branch name
      let branchName = card.gitBranchName;
      if (!branchName) {
        branchName = generateBranchName(
          project.idPrefix,
          card.taskNumber,
          card.title
        );
      }

      // Check if worktree exists or needs to be created
      const expectedWorktreePath = getWorktreePath(workingDir, branchName);
      const worktreeExistsResult = await worktreeExists(workingDir, expectedWorktreePath);

      if (worktreeExistsResult) {
        // Worktree exists - use it
        console.log(`[Git Worktree] Using existing worktree: ${expectedWorktreePath}`);
        actualWorkingDir = expectedWorktreePath;
        gitWorktreePath = expectedWorktreePath;
        gitWorktreeStatus = "active";
        gitBranchName = branchName;
        gitBranchStatus = "active";
      } else {
        // Create new worktree (this also creates the branch if needed)
        console.log(`[Git Worktree] Creating worktree for branch: ${branchName}`);
        const worktreeResult = await createWorktree(workingDir, branchName);

        if (worktreeResult.success) {
          actualWorkingDir = worktreeResult.worktreePath;
          gitWorktreePath = worktreeResult.worktreePath;
          gitWorktreeStatus = "active";
          gitBranchName = branchName;
          gitBranchStatus = "active";
          console.log(`[Git Worktree] Created worktree at: ${worktreeResult.worktreePath}`);
        } else {
          console.error(`[Git Worktree] Failed to create worktree: ${worktreeResult.error}`);
          return NextResponse.json(
            { error: `Failed to create git worktree: ${worktreeResult.error}` },
            { status: 500 }
          );
        }
      }
    }
  } else if ((phase === "implementation" || phase === "retest") && card.gitWorktreePath && shouldUseWorktree) {
    // For retest or subsequent implementation runs, use existing worktree
    const worktreeExistsResult = await worktreeExists(workingDir, card.gitWorktreePath);
    if (worktreeExistsResult) {
      actualWorkingDir = card.gitWorktreePath;
      console.log(`[Git Worktree] Using existing worktree: ${actualWorkingDir}`);
    }
  } else if (!shouldUseWorktree && (phase === "implementation" || phase === "retest")) {
    // No worktree mode - work directly on main branch
    console.log(`[Git] Working directly on main branch (worktrees disabled)`);
  }

  try {
    // Run Claude CLI in the appropriate directory (worktree for implementation)
    const result = await runClaudeCli(prompt, actualWorkingDir, phase);

    // Convert markdown response to HTML for TipTap editor
    const markedHtml = await marked(result.response);
    // Convert checkbox format for TipTap TaskList compatibility
    const htmlResponse = convertToTipTapTaskList(markedHtml);

    // Extract complexity and priority from planning phase response
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

    // Prepare database updates based on phase
    const updatedAt = new Date().toISOString();
    const updates: Record<string, string | null> = {
      status: newStatus,
      updatedAt,
      gitBranchName,
      gitBranchStatus,
      gitWorktreePath,
      gitWorktreeStatus,
    };

    // Clear processing flag on success
    updates.processingType = null;

    switch (phase) {
      case "planning":
        updates.solutionSummary = htmlResponse;
        // Add complexity and priority if extracted
        if (complexity) updates.complexity = complexity;
        if (priority) updates.priority = priority;
        break;
      case "implementation":
        updates.testScenarios = htmlResponse;
        break;
      case "retest":
        // Update testScenarios with results
        updates.testScenarios = htmlResponse;
        break;
    }

    // Update database
    db.update(schema.cards)
      .set(updates)
      .where(eq(schema.cards.id, id))
      .run();

    return NextResponse.json({
      success: true,
      cardId: id,
      phase,
      newStatus,
      response: htmlResponse,
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
    // Clear processing flag on error
    db.update(schema.cards)
      .set({ processingType: null })
      .where(eq(schema.cards.id, id))
      .run();
    return NextResponse.json(
      {
        error: "Failed to run Claude CLI",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

async function runClaudeCli(
  prompt: string,
  cwd: string,
  phase: Phase
): Promise<{ response: string; cost?: number; duration?: number }> {
  const escapedPrompt = escapeShellArg(prompt);

  // Planning phase uses dontAsk for safety (read-only exploration)
  // Implementation and retest need full permissions to write code
  const permissionFlag = phase === "planning"
    ? "--permission-mode dontAsk"
    : "--dangerously-skip-permissions";

  const command = `CI=true claude -p ${escapedPrompt} ${permissionFlag} --output-format json < /dev/null`;

  console.log(`[Claude CLI] Running in ${cwd}:`);
  console.log(`[Claude CLI] Prompt length: ${prompt.length} chars`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 10 * 60 * 1000, // 10 minute timeout for implementation
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    if (stderr) {
      console.log(`[Claude CLI] stderr: ${stderr}`);
    }

    console.log(`[Claude CLI] stdout length: ${stdout.length}`);

    try {
      const response: ClaudeResponse = JSON.parse(stdout);

      if (response.is_error) {
        throw new Error(response.result || "Claude returned an error");
      }

      return {
        response: response.result || "",
        cost: response.cost_usd,
        duration: response.duration_ms,
      };
    } catch {
      console.log(`[Claude CLI] JSON parse failed, using raw output`);
      return { response: stdout.trim() };
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("TIMEOUT")) {
      throw new Error("Claude CLI timed out after 10 minutes");
    }
    throw error;
  }
}
