import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { TerminalApp } from "@/lib/types";
import { buildConflictPrompt } from "@/lib/prompts";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { conflictFiles, worktreePath, branchName } = body;

  if (!worktreePath) {
    return NextResponse.json({ error: "worktreePath is required" }, { status: 400 });
  }

  // Get the card from database
  const card = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();

  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  // Get project for display ID
  const project = card.projectId
    ? db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, card.projectId))
        .get()
    : null;

  const displayId = project && card.taskNumber
    ? `${project.idPrefix}-${card.taskNumber}`
    : `TASK-${card.taskNumber || "X"}`;

  // Get terminal preference from settings
  const terminalSetting = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "terminal_app"))
    .get();

  const terminal = (terminalSetting?.value || "iterm2") as TerminalApp;

  // Build conflict resolution prompt
  const prompt = buildConflictPrompt(displayId, branchName || card.gitBranchName || "feature", conflictFiles || []);

  try {
    // Replace newlines with spaces for AppleScript
    const cleanPrompt = prompt.replace(/\n/g, " ");

    // Build claude command - run in worktree directory
    const claudeCommand = `cd "${worktreePath}" && IDEAFY_CARD_ID="${id}" claude "${cleanPrompt}"`;

    console.log(`[Resolve Conflict] Working dir: ${worktreePath}`);
    console.log(`[Resolve Conflict] Terminal app: ${terminal}`);
    console.log(`[Resolve Conflict] Conflict files: ${conflictFiles?.join(", ") || "none"}`);

    const timestamp = Date.now();
    const scriptPath = join(tmpdir(), `claude-conflict-${timestamp}.sh`);
    writeFileSync(scriptPath, `#!/bin/bash\n${claudeCommand}\n`, { mode: 0o755 });

    if (terminal === "ghostty") {
      spawn("open", ["-na", "Ghostty.app", "--args", "-e", scriptPath]);
    } else {
      const appleScript =
        terminal === "iterm2"
          ? `tell application "iTerm"
    create window with default profile
    tell current session of current window
        write text "${scriptPath}"
    end tell
end tell`
          : `tell application "Terminal"
    do script "${scriptPath}"
    activate
end tell`;

      const osascriptProcess = spawn("osascript", []);
      osascriptProcess.stdin.write(appleScript);
      osascriptProcess.stdin.end();
      osascriptProcess.on("error", (error) => {
        console.error(`[Resolve Conflict] Error: ${error.message}`);
        try { unlinkSync(scriptPath); } catch {}
      });
    }

    return NextResponse.json({
      success: true,
      cardId: id,
      workingDir: worktreePath,
      terminal,
      message: "Terminal opened for conflict resolution",
    });
  } catch (error) {
    console.error("[Resolve Conflict] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to open terminal",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
