import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db, schema } from "@/lib/db";
import type {
  ActivityHistoryEntry,
  ActivityType,
  ProcessType,
  SectionType,
} from "@/lib/types";

const HISTORY_MAX = 10;
// Bell entries below this duration would only flood the inbox — the toast in
// background-processes.tsx already covers short completions.
const BELL_MIN_DURATION_MS = 60_000;

interface RecordInput {
  type: ActivityType;
  cardId?: string | null;
  projectId?: string | null;
  title: string;
  summary?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Persist a completed AI-work event for the topbar activity bell.
 *
 * When `cardId` is provided the row is upserted on `(cardId, type)`: a repeat
 * run replaces the top snapshot and pushes the previous one into
 * `payload.history` (FIFO, max 10). `cardId=null` events (sync etc.) always
 * insert a fresh row because SQLite treats multiple NULLs as distinct in a
 * UNIQUE index.
 *
 * Errors are swallowed: the bell is observability, not part of the critical
 * path. A failed insert must never break the AI flow that just succeeded.
 */
export function recordActivity(input: RecordInput): void {
  try {
    const now = new Date().toISOString();
    const cardId = input.cardId ?? null;
    const projectId = input.projectId ?? null;
    const summary = input.summary ?? null;
    const incomingPayload = input.payload ?? {};

    if (cardId) {
      const existing = db
        .select()
        .from(schema.activityEvents)
        .where(
          and(
            eq(schema.activityEvents.cardId, cardId),
            eq(schema.activityEvents.type, input.type)
          )
        )
        .get();

      if (existing) {
        const prevPayload = parsePayload(existing.payload);
        const prevHistory = Array.isArray(prevPayload.history)
          ? (prevPayload.history as ActivityHistoryEntry[])
          : [];
        const prevSnapshot: ActivityHistoryEntry = {
          summary: existing.summary,
          payload: stripHistory(prevPayload),
          at: existing.updatedAt,
        };
        const newHistory = [prevSnapshot, ...prevHistory].slice(0, HISTORY_MAX);
        const runCount = ((prevPayload.runCount as number | undefined) ?? 1) + 1;

        db.update(schema.activityEvents)
          .set({
            title: input.title,
            summary,
            payload: JSON.stringify({
              ...incomingPayload,
              history: newHistory,
              runCount,
            }),
            isRead: false,
            updatedAt: now,
          })
          .where(eq(schema.activityEvents.id, existing.id))
          .run();
        return;
      }
    }

    db.insert(schema.activityEvents)
      .values({
        id: randomUUID(),
        type: input.type,
        cardId,
        projectId,
        title: input.title,
        summary,
        payload: JSON.stringify({ ...incomingPayload, runCount: 1 }),
        isRead: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  } catch (err) {
    console.error("[activity-registry] failed to record event", err);
  }
}

const VERDICT_LABEL: Record<string, string> = {
  strongyes: "Strong Yes",
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
  strongno: "Strong No",
};

export function verdictLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return VERDICT_LABEL[raw.toLowerCase().replace(/\s+/g, "")] ?? null;
}

export function recordOpinionCompleted(
  cardId: string,
  projectId: string | null,
  args: { verdict: string | null; verdictRaw: string; score: number | null }
): void {
  const label = verdictLabel(args.verdictRaw) ?? "—";
  const summary =
    args.score !== null
      ? `Verdict: ${label} (${args.score}/10)`
      : `Verdict: ${label}`;
  recordActivity({
    type: "opinion",
    cardId,
    projectId,
    title: "AI Opinion completed",
    summary,
    payload: {
      verdict: args.verdict,
      verdictRaw: args.verdictRaw,
      score: args.score,
    },
  });
}

const APPLY_LABEL: Record<string, string> = {
  description: "Detail applied",
  solutionSummary: "Plan applied",
  aiOpinion: "AI Opinion applied",
  testScenarios: "Tests applied",
};

export function recordApplyMessage(
  cardId: string,
  projectId: string | null,
  field: string,
  mode: "replace" | "append"
): void {
  const title = APPLY_LABEL[field] ?? "Card updated";
  recordActivity({
    type: field === "solutionSummary" ? "plan" : "apply",
    cardId,
    projectId,
    title,
    summary: mode === "append" ? "Appended to existing content" : "Replaced existing content",
    payload: { field, mode },
  });
}

const SECTION_LABEL: Record<SectionType, string> = {
  detail: "Detail",
  opinion: "AI Opinion",
  solution: "Solution",
  tests: "Tests",
};

const PROCESS_LABEL: Partial<Record<ProcessType, string>> = {
  autonomous: "Autonomous task",
  "quick-fix": "Quick Fix",
};

function chatTypeFor(section: SectionType | null): ActivityType {
  switch (section) {
    case "opinion":
      return "chat-opinion";
    case "solution":
      return "chat-solution";
    case "tests":
      return "chat-tests";
    case "detail":
    default:
      return "chat-detail";
  }
}

function nonChatTypeFor(processType: ProcessType): ActivityType | null {
  if (processType === "autonomous") return "autonomous";
  if (processType === "quick-fix") return "quickfix";
  // evaluate has its own dedicated call site (recordOpinionCompleted) with
  // richer payload (verdict + score). Don't double-record.
  return null;
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec.toString().padStart(2, "0")}s`;
}

interface ProcessCompletionInput {
  cardId: string;
  projectId: string | null;
  processType: ProcessType;
  sectionType: SectionType | null;
  startedAt: string;
  completedAt: string;
  endReason: "completed" | "aborted";
}

/**
 * Bridge from process-registry → activity bell. Skips short jobs (toast is
 * enough) and aborted runs (a kill is not a "completion" worth pinning).
 * Chat is grouped by section so each tab dedups independently; non-chat jobs
 * use a single per-card row per type.
 */
export function recordProcessCompleted(input: ProcessCompletionInput): void {
  if (input.endReason !== "completed") return;

  const durationMs = new Date(input.completedAt).getTime() - new Date(input.startedAt).getTime();
  if (durationMs < BELL_MIN_DURATION_MS) return;

  let type: ActivityType | null;
  let title: string;

  if (input.processType === "chat") {
    type = chatTypeFor(input.sectionType);
    const sectionLabel = input.sectionType ? SECTION_LABEL[input.sectionType] : "Detail";
    title = `Chat (${sectionLabel}) completed`;
  } else {
    type = nonChatTypeFor(input.processType);
    if (!type) return;
    title = `${PROCESS_LABEL[input.processType] ?? input.processType} completed`;
  }

  recordActivity({
    type,
    cardId: input.cardId,
    projectId: input.projectId,
    title,
    summary: `Duration ${formatDuration(durationMs)}`,
    payload: {
      processType: input.processType,
      sectionType: input.sectionType,
      durationMs,
    },
  });
}

function parsePayload(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function stripHistory(payload: Record<string, unknown>): Record<string, unknown> {
  const { history: _ignored, ...rest } = payload;
  return rest;
}

// Listing/read helpers used by API routes. Kept in the registry so the SQL
// shape (incl. payload JSON parsing) lives in one place.

export interface ActivityListOptions {
  limit?: number;
  unreadOnly?: boolean;
  projectId?: string | null;
}

export function listActivity(options: ActivityListOptions = {}) {
  const { limit = 50, unreadOnly = false, projectId } = options;
  const rows = db
    .select()
    .from(schema.activityEvents)
    .all();

  const filtered = rows
    .filter((row) => (unreadOnly ? !row.isRead : true))
    .filter((row) => {
      if (projectId === undefined) return true;
      if (projectId === null) return row.projectId === null;
      return row.projectId === projectId;
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, limit);

  return filtered.map((row) => ({
    id: row.id,
    type: row.type,
    cardId: row.cardId,
    projectId: row.projectId,
    title: row.title,
    summary: row.summary,
    payload: parsePayload(row.payload),
    isRead: row.isRead,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export function unreadActivityCount(projectId?: string | null): number {
  const rows = db.select().from(schema.activityEvents).all();
  return rows.filter((row) => {
    if (row.isRead) return false;
    if (projectId === undefined) return true;
    if (projectId === null) return row.projectId === null;
    return row.projectId === projectId;
  }).length;
}

export function markActivityRead(ids: string[]): void {
  if (!ids.length) return;
  for (const id of ids) {
    db.update(schema.activityEvents)
      .set({ isRead: true })
      .where(eq(schema.activityEvents.id, id))
      .run();
  }
}

export function markAllActivityRead(): void {
  db.update(schema.activityEvents)
    .set({ isRead: true })
    .where(eq(schema.activityEvents.isRead, false))
    .run();
  // isNull import kept for parity with future projectId-scoped variants.
  void isNull;
}

const RETENTION_DAYS = 30;

/**
 * Drop read activity entries older than RETENTION_DAYS. Idempotent and
 * cheap; intended to run once per app boot. Unread entries stay regardless
 * of age (the user hasn't acknowledged them yet).
 */
export function pruneOldActivity(): void {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const rows = db.select().from(schema.activityEvents).all();
    const stale = rows.filter((row) => row.isRead && row.updatedAt < cutoff);
    if (!stale.length) return;
    for (const row of stale) {
      db.delete(schema.activityEvents)
        .where(eq(schema.activityEvents.id, row.id))
        .run();
    }
    console.log(`[activity-registry] pruned ${stale.length} stale entries`);
  } catch (err) {
    console.error("[activity-registry] prune failed", err);
  }
}
