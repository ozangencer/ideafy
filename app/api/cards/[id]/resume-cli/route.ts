import { NextRequest, NextResponse } from "next/server";
import { eq, and, asc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { cards, projects, chatSessions, conversations } from "@/lib/db/schema";
import { launchTerminal, getTerminalPreference } from "@/lib/terminal-launcher";
import { getProviderForCard } from "@/lib/platform/active";
import { stripHtml } from "@/lib/ai/prompt-builder";
import type { PlatformProvider } from "@/lib/platform/types";

interface OpeningHistoryMessage {
  role: string;
  content: string;
}

function buildResumeCliArgv(provider: PlatformProvider, sessionId: string): string[] {
  switch (provider.id) {
    case "codex":
      return [provider.getCliPath(), "resume", "--include-non-interactive", sessionId];
    case "gemini":
      return [provider.getCliPath(), "--resume", sessionId];
    case "opencode":
      return [provider.getCliPath(), "--session", sessionId];
    case "claude":
    default:
      return [provider.getCliPath(), "--resume", sessionId];
  }
}

// Fresh interactive launch. For Claude we can reserve a UUID upfront via
// --session-id, which makes the resulting session immediately persistable
// in chat_sessions. Other providers auto-generate their IDs at runtime so
// we launch without one — chat-stream will capture the ID on the next
// in-app message.
function buildFreshCliArgv(
  provider: PlatformProvider,
  newSessionId: string | null,
  openingPrompt: string,
): string[] {
  const cli = provider.getCliPath();
  const prompt = openingPrompt.replace(/\n/g, " ");
  switch (provider.id) {
    case "claude":
      return newSessionId
        ? [cli, "--session-id", newSessionId, prompt]
        : [cli, prompt];
    case "codex":
    case "gemini":
    case "opencode":
    default:
      return [cli, prompt];
  }
}

const OPENING_HISTORY_CHAR_CAP = 6000;

function buildOpeningPrompt(args: {
  displayId: string;
  title: string;
  description: string;
  sectionType: string;
  sectionContent: string;
  history: OpeningHistoryMessage[];
}): string {
  const lines: string[] = [];
  lines.push(
    `You are continuing work on Ideafy card [${args.displayId}] "${args.title}" in the ${args.sectionType} section.`,
  );
  if (args.description.trim()) {
    lines.push("", "Description:", args.description.trim().slice(0, 1500));
  }
  if (args.sectionContent.trim()) {
    lines.push("", `Current ${args.sectionType} content:`, args.sectionContent.trim().slice(0, 1500));
  }

  if (args.history.length > 0) {
    lines.push("", "Prior conversation (most recent last):");
    let budget = OPENING_HISTORY_CHAR_CAP;
    const rendered: string[] = [];
    for (let i = args.history.length - 1; i >= 0 && budget > 0; i--) {
      const msg = args.history[i];
      const clean = stripHtml(msg.content || "").trim();
      if (!clean) continue;
      const truncated = clean.length > 1200 ? clean.slice(0, 1200) + "…" : clean;
      const entry = `${msg.role === "user" ? "User" : "Assistant"}: ${truncated}`;
      if (entry.length > budget) {
        rendered.unshift(entry.slice(0, budget) + "…");
        break;
      }
      rendered.unshift(entry);
      budget -= entry.length + 1;
    }
    lines.push(...rendered);
  }

  lines.push(
    "",
    "The user is now continuing this conversation directly in the terminal. Wait for their next message; do not re-summarise the above unless asked.",
  );
  return lines.join("\n");
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

  const [card] = await db.select().from(cards).where(eq(cards.id, cardId));
  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const provider = getProviderForCard(card);

  const [session] = await db.select().from(chatSessions)
    .where(and(
      eq(chatSessions.cardId, cardId),
      eq(chatSessions.sectionType, sectionType),
      eq(chatSessions.provider, provider.id)
    ));

  const project = card.projectId
    ? (await db.select().from(projects).where(eq(projects.id, card.projectId)))[0]
    : null;

  const workingDir = project?.folderPath || card.projectFolder || process.cwd();
  const terminal = getTerminalPreference();

  // Resume path — existing session found for the active provider.
  if (session) {
    try {
      launchTerminal({
        cwd: workingDir,
        argv: buildResumeCliArgv(provider, session.cliSessionId),
        terminal,
        tag: "Resume CLI",
      });
      return NextResponse.json({
        success: true,
        mode: "resume",
        sessionId: session.cliSessionId,
        provider: provider.id,
        message: `Resuming ${provider.displayName} session in ${terminal}`,
      });
    } catch (error) {
      return NextResponse.json(
        { error: "Failed to open terminal", details: error instanceof Error ? error.message : String(error) },
        { status: 500 }
      );
    }
  }

  // Silent fresh-session fallback — no session for this card/section/provider.
  // Build an opening prompt from the conversation so the CLI lands with the
  // same context the chat tab has, then launch interactively.
  const history = await db
    .select()
    .from(conversations)
    .where(and(
      eq(conversations.cardId, cardId),
      eq(conversations.sectionType, sectionType),
    ))
    .orderBy(asc(conversations.createdAt));

  const displayId = card.taskNumber ? `IDE-${card.taskNumber}` : cardId;
  const openingPrompt = buildOpeningPrompt({
    displayId,
    title: card.title,
    description: stripHtml(card.description || ""),
    sectionType,
    sectionContent: stripHtml(
      sectionType === "tests" ? card.testScenarios :
      sectionType === "solution" ? card.solutionSummary :
      sectionType === "opinion" ? card.aiOpinion :
      card.description,
    ),
    history,
  });

  const canReserveSessionId = provider.id === "claude" && provider.capabilities.supportsSessionResume;
  const newSessionId = canReserveSessionId ? uuidv4() : null;

  try {
    launchTerminal({
      cwd: workingDir,
      argv: buildFreshCliArgv(provider, newSessionId, openingPrompt),
      terminal,
      tag: "Resume CLI (fresh)",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to open terminal", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }

  // Record the reserved session up-front for Claude so the next resume click
  // lands on the same CLI session. Non-Claude providers auto-assign an ID at
  // runtime — chat-stream picks it up on the next in-app message.
  if (newSessionId) {
    const now = new Date().toISOString();
    try {
      await db.insert(chatSessions).values({
        id: uuidv4(),
        cardId,
        sectionType,
        cliSessionId: newSessionId,
        provider: provider.id,
        createdAt: now,
        lastUsedAt: now,
      }).onConflictDoUpdate({
        target: [chatSessions.cardId, chatSessions.sectionType, chatSessions.provider],
        set: {
          cliSessionId: newSessionId,
          lastUsedAt: now,
        },
      });
    } catch (error) {
      console.error("[resume-cli] failed to persist reserved session:", error);
    }
  }

  return NextResponse.json({
    success: true,
    mode: "fresh",
    sessionId: newSessionId,
    provider: provider.id,
    message: `Starting new ${provider.displayName} session in ${terminal}`,
  });
}
