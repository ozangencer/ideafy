import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { TerminalApp } from "@/lib/types";
import { buildConflictPrompt } from "@/lib/prompts";
import { launchTerminal } from "@/lib/terminal-launcher";
import { claudeProvider } from "@/lib/platform/claude-provider";

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

  const displayId = project && card.taskNumber
    ? `${project.idPrefix}-${card.taskNumber}`
    : `TASK-${card.taskNumber || "X"}`;

  const terminalSetting = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "terminal_app"))
    .get();

  const terminal = (terminalSetting?.value || "iterm2") as TerminalApp;

  const prompt = buildConflictPrompt(
    displayId,
    branchName || card.gitBranchName || "feature",
    conflictFiles || []
  );

  try {
    const cleanPrompt = prompt.replace(/\n/g, " ");

    console.log(`[Resolve Conflict] Working dir: ${worktreePath}`);
    console.log(`[Resolve Conflict] Terminal app: ${terminal}`);
    console.log(`[Resolve Conflict] Conflict files: ${conflictFiles?.join(", ") || "none"}`);

    launchTerminal({
      cwd: worktreePath,
      argv: [claudeProvider.getCliPath(), cleanPrompt],
      env: { IDEAFY_CARD_ID: id },
      terminal,
      tag: "Resolve Conflict",
    });

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
