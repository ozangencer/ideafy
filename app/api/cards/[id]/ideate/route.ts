import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { TerminalApp } from "@/lib/types";
import { stripHtml, buildIdeationPrompt, saveCardImagesToTemp, generateImageReferences } from "@/lib/prompts";

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

  let prompt = buildIdeationPrompt(card);

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
    const cliCommand = provider.buildInteractiveCommand(
      { prompt, cardId: id, permissionMode },
      workingDir
    );

    console.log(`[Ideate] Terminal app: ${terminal}`);
    console.log(`[Ideate] Prompt length: ${prompt.length} chars`);

    const timestamp = Date.now();
    const scriptPath = join(tmpdir(), `ideafy-ideate-${timestamp}.sh`);
    writeFileSync(scriptPath, `#!/bin/bash\n${cliCommand}\n`, { mode: 0o755 });

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
        console.error(`[Ideate] Error: ${error.message}`);
        try { unlinkSync(scriptPath); } catch {}
      });
    }

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
