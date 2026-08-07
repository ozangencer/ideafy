import { eq, and } from "drizzle-orm";
import { db, schema } from "./db";
import { getPlatformProvider } from "./platform";
import type { PlatformProvider } from "./platform/types";
import type { AiPlatform } from "./types";

// A CLI session that belongs to a card, from either of the two places
// Ideafy records one:
//
//   chat_sessions    — sessions Ideafy itself started (in-app chat, or a
//                      "Resume CLI (fresh)" launch). Scoped to a section.
//   ideafy_sessions  — sessions the user started in their own terminal and
//                      bound to a card via the hook / bind_session_to_card.
//                      Card-scoped; no section.
//
// Until now only the first was readable from the UI, so a session started in
// the terminal was invisible even though its ID was sitting in the DB.
export interface CardSession {
  sessionId: string;
  provider: string;
  cwd: string | null;
  sectionType: string | null;
  lastUsedAt: string;
  source: "chat" | "terminal";
}

const KNOWN_PLATFORMS: readonly AiPlatform[] = ["claude", "gemini", "codex", "opencode"];

// A session's provider comes from the DB as a plain string, so it may not
// match a platform we know — guard rather than letting the factory throw.
export function resolveSessionProvider(id: string): PlatformProvider | null {
  if (!KNOWN_PLATFORMS.includes(id as AiPlatform)) return null;
  try {
    return getPlatformProvider(id as AiPlatform);
  } catch {
    return null;
  }
}

// Resume argv per provider. Moved here from the resume-cli route so the
// terminal launcher and the copyable command string stay in agreement.
export function buildResumeCliArgv(provider: PlatformProvider, sessionId: string): string[] {
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

function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_./:=-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

// The single line a user can paste into a terminal. Uses the bare binary
// name rather than the resolved absolute path — the launcher needs the full
// path, but a human pasting this has the CLI on their PATH already.
export function buildResumeCommand(provider: PlatformProvider, sessionId: string): string {
  const [, ...rest] = buildResumeCliArgv(provider, sessionId);
  return [provider.id, ...rest].map(shellQuote).join(" ");
}

// Both tables, newest first, one row per session ID. A session recorded in
// both places keeps the chat_sessions entry — it is the only one carrying a
// section, and its lastUsedAt is maintained per message rather than per turn.
export function listCardSessions(cardId: string): CardSession[] {
  const chatRows = db
    .select()
    .from(schema.chatSessions)
    .where(eq(schema.chatSessions.cardId, cardId))
    .all();

  const terminalRows = db
    .select()
    .from(schema.ideafySessions)
    .where(
      and(
        eq(schema.ideafySessions.cardId, cardId),
        eq(schema.ideafySessions.state, "bound")
      )
    )
    .all();

  const byId = new Map<string, CardSession>();

  for (const row of chatRows) {
    byId.set(row.cliSessionId, {
      sessionId: row.cliSessionId,
      provider: row.provider,
      cwd: null,
      sectionType: row.sectionType,
      lastUsedAt: row.lastUsedAt,
      source: "chat",
    });
  }

  for (const row of terminalRows) {
    if (byId.has(row.sessionId)) continue;
    byId.set(row.sessionId, {
      sessionId: row.sessionId,
      provider: row.provider,
      cwd: row.cwd,
      sectionType: null,
      lastUsedAt: row.updatedAt,
      source: "terminal",
    });
  }

  return Array.from(byId.values()).sort((a, b) =>
    b.lastUsedAt.localeCompare(a.lastUsedAt)
  );
}

export interface CardSessionWithCommand extends CardSession {
  command: string | null;
  providerLabel: string;
}

// Attaches the paste-ready command to each row. Provider comes from the
// session itself, not from the card's active platform — a card worked on in
// Claude yesterday and Codex today has one of each.
export function listCardSessionsWithCommands(cardId: string): CardSessionWithCommand[] {
  return listCardSessions(cardId).map((session) => {
    const provider = resolveSessionProvider(session.provider);
    return {
      ...session,
      command: provider ? buildResumeCommand(provider, session.sessionId) : null,
      providerLabel: provider?.displayName ?? session.provider,
    };
  });
}
