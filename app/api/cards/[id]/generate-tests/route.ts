import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { TerminalApp } from "@/lib/types";
import { buildTestGenerationPrompt, stripHtml } from "@/lib/prompts";
import { worktreeExists } from "@/lib/git";
import { launchTerminal } from "@/lib/terminal-launcher";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Parse optional selected scenarios from request body
  let selectedScenarios: string[] | null = null;
  try {
    const body = await request.json();
    if (Array.isArray(body.selectedScenarios) && body.selectedScenarios.length > 0) {
      selectedScenarios = body.selectedScenarios;
    }
  } catch {
    // No body or invalid JSON — use all scenarios
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

  // Card must have testScenarios to generate tests
  if (!card.testScenarios || stripHtml(card.testScenarios) === "") {
    return NextResponse.json(
      { error: "Card has no test scenarios to convert" },
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

  // Get terminal preference from settings
  const terminalSetting = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "terminal_app"))
    .get();

  const terminal = (terminalSetting?.value || "iterm2") as TerminalApp;

  const workingDir = project?.folderPath || card.projectFolder || process.cwd();

  // Determine actual working directory (use worktree if exists)
  let actualWorkingDir = workingDir;
  if (card.gitWorktreePath) {
    const worktreeExistsResult = await worktreeExists(workingDir, card.gitWorktreePath);
    if (worktreeExistsResult) {
      actualWorkingDir = card.gitWorktreePath;
      console.log(`[Generate Tests] Using worktree: ${actualWorkingDir}`);
    }
  }

  // Build display ID
  const displayId = project && card.taskNumber
    ? `${project.idPrefix}-${card.taskNumber}`
    : null;

  // Build prompt — use selected scenarios if provided, otherwise all
  const scenariosForPrompt = selectedScenarios
    ? selectedScenarios.join("\n- ")
    : null;

  const prompt = buildTestGenerationPrompt(
    {
      id: card.id,
      title: card.title,
      testScenarios: card.testScenarios,
    },
    displayId,
    scenariosForPrompt
  );

  try {
    const { getProviderForCard } = await import("@/lib/platform/active");
    const provider = getProviderForCard(card);

    const invocation = provider.buildInteractiveCommand(
      { prompt, cardId: id },
      actualWorkingDir
    );

    console.log(`[Generate Tests] Working dir: ${actualWorkingDir}`);
    console.log(`[Generate Tests] Prompt length: ${prompt.length} chars`);
    console.log(`[Generate Tests] Terminal app: ${terminal}`);

    launchTerminal({ ...invocation, terminal, tag: "Generate Tests" });

    return NextResponse.json({
      success: true,
      cardId: id,
      workingDir: actualWorkingDir,
      terminal,
    });
  } catch (error) {
    console.error("Generate tests error:", error);
    return NextResponse.json(
      {
        error: "Failed to open terminal",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
