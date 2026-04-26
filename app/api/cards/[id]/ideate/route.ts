import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { TerminalApp } from "@/lib/types";
import { stripHtml, buildIdeationPrompt, saveCardImagesToTemp, generateImageReferences } from "@/lib/prompts";
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

  // Only allow ideation cards
  if (card.status !== "ideation") {
    return NextResponse.json(
      { error: "Interactive ideation is only available for cards in Ideation column" },
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

  if (!card.description || stripHtml(card.description) === "") {
    return NextResponse.json(
      { error: "Card has no description to discuss" },
      { status: 400 }
    );
  }

  let prompt = buildIdeationPrompt(card, project?.voice as never);

  // Extract and save images for CLI context
  const savedImages = saveCardImagesToTemp(card.id, card);
  const imageReferences = generateImageReferences(savedImages);
  if (imageReferences) {
    prompt = `${prompt}\n\n${imageReferences}`;
  }

  console.log(`[Ideate] Opening interactive ideation for card: ${id}`);
  console.log(`[Ideate] Working dir: ${workingDir}`);

  try {
    const { getProviderForCard } = await import("@/lib/platform/active");
    const provider = getProviderForCard(card);

    // Build the terminal command using the active provider
    const permissionMode = provider.capabilities.supportsPermissionModes ? "plan" : null;
    const invocation = provider.buildInteractiveCommand(
      { prompt, cardId: id, permissionMode },
      workingDir
    );

    console.log(`[Ideate] Terminal app: ${terminal}`);
    console.log(`[Ideate] Prompt length: ${prompt.length} chars`);

    launchTerminal({ ...invocation, terminal, tag: "Ideate" });

    return NextResponse.json({
      success: true,
      cardId: id,
      workingDir,
      terminal,
    });
  } catch (error) {
    console.error("Ideate error:", error);
    return NextResponse.json(
      {
        error: "Failed to open terminal for ideation",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
