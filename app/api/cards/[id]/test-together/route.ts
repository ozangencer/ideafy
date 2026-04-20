import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { TerminalApp } from "@/lib/types";
import { stripHtml, buildTestTogetherPrompt, saveCardImagesToTemp, generateImageReferences } from "@/lib/prompts";
import { launchTerminal } from "@/lib/terminal-launcher";

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

  // Only allow test cards
  if (card.status !== "test") {
    return NextResponse.json(
      { error: "Test Together is only available for cards in Human Test column" },
      { status: 400 }
    );
  }

  // Must have test scenarios
  if (!card.testScenarios || stripHtml(card.testScenarios) === "") {
    return NextResponse.json(
      { error: "Card has no test scenarios" },
      { status: 400 }
    );
  }

  // Get project for working directory and display ID
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

  // Use worktree path if available, otherwise project path
  const workingDir = card.gitWorktreePath || project?.folderPath || card.projectFolder || process.cwd();

  const displayId = project && card.taskNumber
    ? `${project.idPrefix}-${card.taskNumber}`
    : null;

  let prompt = buildTestTogetherPrompt(card, displayId);

  // Extract and save images for CLI context
  const savedImages = saveCardImagesToTemp(card.id, card);
  const imageReferences = generateImageReferences(savedImages);
  if (imageReferences) {
    prompt = `${prompt}\n\n${imageReferences}`;
  }

  console.log(`[TestTogether] Opening interactive test session for card: ${id}`);
  console.log(`[TestTogether] Working dir: ${workingDir}`);

  try {
    const { getProviderForCard } = await import("@/lib/platform/active");
    const provider = getProviderForCard(card);

    // No permission mode restriction - test may need to run commands
    const invocation = provider.buildInteractiveCommand(
      { prompt, cardId: id, permissionMode: null },
      workingDir
    );

    console.log(`[TestTogether] Terminal app: ${terminal}`);
    console.log(`[TestTogether] Prompt length: ${prompt.length} chars`);

    launchTerminal({ ...invocation, terminal, tag: "TestTogether" });

    return NextResponse.json({
      success: true,
      cardId: id,
      workingDir,
      terminal,
    });
  } catch (error) {
    console.error("TestTogether error:", error);
    return NextResponse.json(
      {
        error: "Failed to open terminal for testing",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
