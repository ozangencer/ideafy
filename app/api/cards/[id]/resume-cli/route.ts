import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards, projects, chatSessions } from "@/lib/db/schema";
import { launchTerminal, getTerminalPreference } from "@/lib/terminal-launcher";
import { getProviderForCard } from "@/lib/platform/active";

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

  // Get session
  const [session] = await db.select().from(chatSessions)
    .where(and(eq(chatSessions.cardId, cardId), eq(chatSessions.sectionType, sectionType)));

  if (!session) {
    return NextResponse.json({ error: "No CLI session found for this card. Send a message first." }, { status: 404 });
  }

  // Get project for working dir
  const project = card.projectId
    ? (await db.select().from(projects).where(eq(projects.id, card.projectId)))[0]
    : null;

  const workingDir = project?.folderPath || card.projectFolder || process.cwd();
  const provider = getProviderForCard(card);
  const terminal = getTerminalPreference();

  // Build resume command
  const cliCommand = `cd "${workingDir}" && ${provider.getCliPath()} --resume "${session.cliSessionId}"`;

  try {
    launchTerminal({ command: cliCommand, terminal });

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
