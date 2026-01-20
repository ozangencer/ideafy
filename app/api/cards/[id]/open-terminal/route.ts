import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exec, execSync, spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { TerminalApp, Status } from "@/lib/types";
import {
  generateBranchName,
  isGitRepo,
  createWorktree,
  worktreeExists,
  getWorktreePath,
} from "@/lib/git";

type Phase = "planning" | "implementation" | "retest";

function stripHtml(html: string): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function detectPhase(card: { solutionSummary: string | null; testScenarios: string | null }): Phase {
  const hasSolution = card.solutionSummary && stripHtml(card.solutionSummary) !== "";
  const hasTests = card.testScenarios && stripHtml(card.testScenarios) !== "";

  if (!hasSolution) return "planning";
  if (!hasTests) return "implementation";
  return "retest";
}

interface PromptContext {
  card: {
    id: string;
    title: string;
    description: string;
    solutionSummary: string | null;
    testScenarios: string | null;
  };
  displayId: string | null;
  gitBranchName: string | null;
}

function buildPrompt(phase: Phase, ctx: PromptContext): string {
  const { card, displayId, gitBranchName } = ctx;
  const title = stripHtml(card.title);
  const description = stripHtml(card.description);
  const solution = card.solutionSummary ? stripHtml(card.solutionSummary) : "";
  const tests = card.testScenarios ? stripHtml(card.testScenarios) : "";

  const taskHeader = displayId ? `[${displayId}] ${title}` : title;
  const branchInfo = gitBranchName ? `Git Branch: ${gitBranchName}` : "";

  switch (phase) {
    case "implementation":
      return `# ${taskHeader}
${branchInfo}

## Instructions
1. First, read the card details using: mcp__kanban__get_card with id: "${card.id}"
2. Review the solutionSummary field for the implementation plan
3. Implement the plan
4. When done, save test scenarios using mcp__kanban__save_tests`;

    case "retest":
      return `# ${taskHeader}
${branchInfo}

## Context
The user tested this implementation but encountered an error.

## Instructions
1. First, read the card details using: mcp__kanban__get_card with id: "${card.id}"
2. Review the solutionSummary and description fields
3. Wait for the user to describe the error they encountered
4. Analyze the error and identify the root cause
5. Fix the issues while preserving the original solution approach
6. When done, save updated test scenarios using mcp__kanban__save_tests`;

    case "planning":
      return `# ${taskHeader}

## Instructions
1. First, read the card details using: mcp__kanban__get_card with id: "${card.id}"
2. Review the description field for task requirements
3. Analyze this task and create a detailed implementation plan
4. Do NOT implement yet - only plan`;
  }
}

function getNewStatus(phase: Phase, currentStatus: Status): Status {
  switch (phase) {
    case "planning":
      return "progress";
    case "implementation":
      return "progress"; // Stay in progress during interactive implementation
    case "retest":
      return currentStatus;
  }
}

function getAppleScript(terminal: "iterm2" | "terminal", command: string): string {
  // For AppleScript double-quoted strings:
  // 1. Escape backslashes first: \ → \\
  // 2. Then escape double quotes: " → \"
  const escapedCommand = command
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  if (terminal === "iterm2") {
    return `
tell application "iTerm2"
    create window with default profile
    tell current session of current window
        write text "${escapedCommand}"
    end tell
end tell`;
  }

  // Terminal.app
  return `
tell application "Terminal"
    do script "${escapedCommand}"
    activate
end tell`;
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

  // Get terminal preference from settings
  const terminalSetting = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "terminal_app"))
    .get();

  const terminal = (terminalSetting?.value || "iterm2") as TerminalApp;

  const workingDir = project?.folderPath || card.projectFolder || process.cwd();

  if (!card.description || stripHtml(card.description) === "") {
    return NextResponse.json(
      { error: "Card has no description to use as prompt" },
      { status: 400 }
    );
  }

  // Detect current phase
  const phase = detectPhase(card);

  const newStatus = getNewStatus(phase, card.status as Status);

  console.log(`[Open Terminal] Phase: ${phase}`);
  console.log(`[Open Terminal] Current status: ${card.status} → New status: ${newStatus}`);

  // Worktree creation for implementation phase
  let gitBranchName = card.gitBranchName;
  let gitWorktreePath = card.gitWorktreePath;
  let gitWorktreeStatus = card.gitWorktreeStatus;
  let actualWorkingDir = workingDir;

  // Only use worktrees if project has it enabled (default: true)
  const shouldUseWorktree = project?.useWorktrees ?? true;

  if (phase === "implementation" && project && card.taskNumber && shouldUseWorktree) {
    const repoCheck = await isGitRepo(workingDir);

    if (repoCheck) {
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
        console.log(`[Open Terminal] Using existing worktree: ${expectedWorktreePath}`);
        actualWorkingDir = expectedWorktreePath;
        gitWorktreePath = expectedWorktreePath;
        gitWorktreeStatus = "active";
        gitBranchName = branchName;
      } else {
        // Create new worktree
        console.log(`[Open Terminal] Creating worktree for branch: ${branchName}`);
        const worktreeResult = await createWorktree(workingDir, branchName);

        if (worktreeResult.success) {
          actualWorkingDir = worktreeResult.worktreePath;
          gitWorktreePath = worktreeResult.worktreePath;
          gitWorktreeStatus = "active";
          gitBranchName = branchName;

          // Update card with worktree info
          db.update(schema.cards)
            .set({
              gitBranchName: branchName,
              gitBranchStatus: "active",
              gitWorktreePath: worktreeResult.worktreePath,
              gitWorktreeStatus: "active",
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.cards.id, id))
            .run();

          console.log(`[Open Terminal] Worktree created: ${worktreeResult.worktreePath}`);
        } else {
          console.error(`[Open Terminal] Worktree creation failed: ${worktreeResult.error}`);
          return NextResponse.json(
            { error: `Git worktree yaratılamadı: ${worktreeResult.error}` },
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
      console.log(`[Open Terminal] Using existing worktree: ${actualWorkingDir}`);
    }
  } else if (!shouldUseWorktree && (phase === "implementation" || phase === "retest")) {
    // No worktree mode - work directly on main branch
    console.log(`[Open Terminal] Working directly on main branch (worktrees disabled)`);
  }

  // Build prompt AFTER branch is resolved
  const displayId = project && card.taskNumber
    ? `${project.idPrefix}-${card.taskNumber}`
    : null;

  const prompt = buildPrompt(phase, {
    card,
    displayId,
    gitBranchName,
  });

  try {
    // Update card status in database BEFORE opening terminal
    if (card.status !== newStatus) {
      const updatedAt = new Date().toISOString();
      db.update(schema.cards)
        .set({
          status: newStatus,
          updatedAt,
        })
        .where(eq(schema.cards.id, id))
        .run();
    }

    // Replace newlines with spaces (AppleScript strings can't contain raw newlines)
    // Other escaping (quotes, backslashes) is handled by getAppleScript
    const cleanPrompt = prompt.replace(/\n/g, " ");

    // Note: kanban MCP server is globally configured via `claude mcp add`
    // KANBAN_CARD_ID env var is used by the hook to detect kanban sessions
    // Planning phase uses --permission-mode plan, others use normal mode
    const permissionFlag = phase === "planning" ? " --permission-mode plan" : "";
    const claudeCommand = `cd "${actualWorkingDir}" && KANBAN_CARD_ID="${id}" claude "${cleanPrompt}"${permissionFlag}`;

    console.log(`[Open Terminal] Working dir: ${actualWorkingDir}`);
    console.log(`[Open Terminal] Prompt length: ${prompt.length} chars`);
    console.log(`[Open Terminal] Terminal app: ${terminal}`);

    if (terminal === "ghostty") {
      // Ghostty doesn't support AppleScript
      // Copy command to clipboard and open Ghostty
      execSync(`echo "${claudeCommand.replace(/"/g, '\\"')}" | pbcopy`);
      exec("open -a Ghostty", (error) => {
        if (error) {
          console.error(`[Open Terminal] Error opening Ghostty: ${error.message}`);
        }
      });

      return NextResponse.json({
        success: true,
        cardId: id,
        phase,
        newStatus,
        workingDir: actualWorkingDir,
        terminal,
        gitBranchName,
        gitWorktreePath,
        gitWorktreeStatus,
        message: "Ghostty opened. Command copied to clipboard - press Cmd+V to paste.",
      });
    }

    // iTerm2 or Terminal.app - use AppleScript
    // Write command to temp script to avoid complex escaping
    const timestamp = Date.now();
    const scriptPath = join(tmpdir(), `ideafy-${timestamp}.sh`);
    writeFileSync(scriptPath, `#!/bin/bash\n${claudeCommand}\n`, { mode: 0o755 });

    // Note: App is named "iTerm" not "iTerm2" on this system
    const appName = terminal === "iterm2" ? "iTerm" : "Terminal";

    const appleScript = terminal === "iterm2"
      ? `tell application "${appName}"
    create window with default profile
    tell current session of current window
        write text "${scriptPath}"
    end tell
end tell`
      : `tell application "${appName}"
    do script "${scriptPath}"
    activate
end tell`;

    const osascriptProcess = spawn("osascript", []);
    osascriptProcess.stdin.write(appleScript);
    osascriptProcess.stdin.end();
    osascriptProcess.on("error", (error) => {
      console.error(`[Open Terminal] Error: ${error.message}`);
      try { unlinkSync(scriptPath); } catch {}
    });

    return NextResponse.json({
      success: true,
      cardId: id,
      phase,
      newStatus,
      workingDir: actualWorkingDir,
      terminal,
      gitBranchName,
      gitWorktreePath,
      gitWorktreeStatus,
    });
  } catch (error) {
    console.error("Open terminal error:", error);
    return NextResponse.json(
      {
        error: "Failed to open terminal",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
