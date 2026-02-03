import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { spawn } from "child_process";
import { marked } from "marked";
import type { Status } from "@/lib/types";
import {
  generateBranchName,
  isGitRepo,
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
import {
  registerProcess,
  completeProcess,
  getProcess,
  killProcess,
} from "@/lib/process-registry";
import { getClaudePath, getClaudeCIEnv } from "@/lib/claude-cli";

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

  // Compute display ID for process tracking
  const displayId = project && card.taskNumber
    ? `${project.idPrefix}-${card.taskNumber}`
    : null;
  const processKey = `${id}-autonomous`;

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
    const result = await runClaudeCli({
      prompt,
      cwd: actualWorkingDir,
      phase,
      processKey,
      cardId: id,
      cardTitle: card.title,
      displayId,
    });

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

interface RunClaudeOptions {
  prompt: string;
  cwd: string;
  phase: Phase;
  processKey: string;
  cardId: string;
  cardTitle: string;
  displayId: string | null;
}

async function runClaudeCli(
  options: RunClaudeOptions
): Promise<{ response: string; cost?: number; duration?: number }> {
  const { prompt, cwd, phase, processKey, cardId, cardTitle, displayId } = options;

  // Kill any existing process for this card
  const existing = getProcess(processKey);
  if (existing) {
    killProcess(processKey);
  }

  // Planning phase uses dontAsk for safety (read-only exploration)
  // Implementation and retest need full permissions to write code
  const permissionFlag = phase === "planning"
    ? "--permission-mode"
    : "--dangerously-skip-permissions";
  const permissionValue = phase === "planning" ? "dontAsk" : null;

  const args = [
    "-p", prompt,
    ...(permissionValue ? [permissionFlag, permissionValue] : [permissionFlag]),
    "--output-format", "json",
    // Skip project-level hooks (e.g. UserPromptSubmit that injects save_plan instructions)
    // Autonomous flow handles saving automatically, so project hooks interfere
    "--setting-sources", "user",
  ];

  console.log(`[Claude CLI] Running in ${cwd}:`);
  console.log(`[Claude CLI] Prompt length: ${prompt.length} chars`);

  return new Promise((resolve, reject) => {
    const claudeProcess = spawn(getClaudePath(), args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: getClaudeCIEnv(),
    });

    // Close stdin immediately (equivalent to < /dev/null)
    claudeProcess.stdin?.end();

    // Register process for tracking
    registerProcess(processKey, claudeProcess, {
      cardId,
      sectionType: null,
      processType: "autonomous",
      cardTitle,
      displayId,
      startedAt: new Date().toISOString(),
    });

    let stdout = "";
    let stderr = "";

    claudeProcess.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    claudeProcess.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // Set timeout
    const timeout = setTimeout(() => {
      claudeProcess.kill();
      completeProcess(processKey);
      reject(new Error("Claude CLI timed out after 10 minutes"));
    }, 10 * 60 * 1000);

    claudeProcess.on("close", (code) => {
      clearTimeout(timeout);
      completeProcess(processKey);

      if (stderr) {
        console.log(`[Claude CLI] stderr: ${stderr}`);
      }
      console.log(`[Claude CLI] stdout length: ${stdout.length}`);

      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const response: ClaudeResponse = JSON.parse(stdout);
        if (response.is_error) {
          reject(new Error(response.result || "Claude returned an error"));
          return;
        }
        resolve({
          response: response.result || "",
          cost: response.cost_usd,
          duration: response.duration_ms,
        });
      } catch {
        console.log(`[Claude CLI] JSON parse failed, using raw output`);
        resolve({ response: stdout.trim() });
      }
    });

    claudeProcess.on("error", (error) => {
      clearTimeout(timeout);
      completeProcess(processKey);
      reject(error);
    });
  });
}
