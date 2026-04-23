import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards, projects, chatSessions } from "@/lib/db/schema";
import { launchTerminal, getTerminalPreference } from "@/lib/terminal-launcher";
import { getProviderForCard } from "@/lib/platform/active";
import type { PlatformProvider } from "@/lib/platform/types";

function buildResumeCliArgv(provider: PlatformProvider, sessionId: string): string[] {
  switch (provider.id) {
    case "codex":
      return [provider.getCliPath(), "resume", "--include-non-interactive", sessionId];
    case "gemini":
      return [provider.getCliPath(), "--resume", sessionId];
    case "claude":
    default:
      return [provider.getCliPath(), "--resume", sessionId];
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: cardId } = await params;
  const body = await request.json();
  const { sectionType } = body;

  if (!sectionType) {
    return NextResponse.json({ error: "sectionType is required" }, { status: 400 });
  }

  // Get card
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId));
  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const provider = getProviderForCard(card);

  // Get session for the card's current provider. A card may switch providers
  // after a chat, and session IDs are not portable across CLIs.
  const [session] = await db.select().from(chatSessions)
    .where(and(
      eq(chatSessions.cardId, cardId),
      eq(chatSessions.sectionType, sectionType),
      eq(chatSessions.provider, provider.id)
    ));

  if (!session) {
    return NextResponse.json({ error: "No CLI session found for this card. Send a message first." }, { status: 404 });
  }

  // Get project for working dir
  const project = card.projectId
    ? (await db.select().from(projects).where(eq(projects.id, card.projectId)))[0]
    : null;

  const workingDir = project?.folderPath || card.projectFolder || process.cwd();
  const terminal = getTerminalPreference();

  try {
    launchTerminal({
      cwd: workingDir,
      argv: buildResumeCliArgv(provider, session.cliSessionId),
      terminal,
      tag: "Resume CLI",
    });

    return NextResponse.json({
      success: true,
      sessionId: session.cliSessionId,
      message: `Resuming session in ${terminal}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to open terminal", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
