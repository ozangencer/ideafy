import { and, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { groupTodayActivity } from "@/lib/today-activity";
import type { TodayCard } from "@/lib/types";

/**
 * The cards touched since `since`, for Focus view's Today panel.
 *
 * Read from three sources that already record every step on their own row:
 * `conversations`, `ideafy_sessions` and `cards.completedAt`. The bell's
 * `activity_events` is deliberately left out — it upserts on (cardId, type)
 * and skips short runs, so it is an inbox, not a record of the day.
 *
 * `since` must be an ISO string; stored timestamps are ISO too, so plain
 * string comparison orders them correctly.
 */
export function listTodayActivity(opts: {
  since: string;
  projectId?: string | null;
}): TodayCard[] {
  const { since, projectId } = opts;

  // Only the user's own turns: a one-shot run writes assistant rows too, and
  // counting them would double every number and blur "turns I took".
  const chats = db
    .select({
      cardId: schema.conversations.cardId,
      sectionType: schema.conversations.sectionType,
      count: sql<number>`count(*)`,
      lastAt: sql<string>`max(${schema.conversations.createdAt})`,
    })
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.role, "user"),
        gte(schema.conversations.createdAt, since)
      )
    )
    .groupBy(schema.conversations.cardId, schema.conversations.sectionType)
    .all();

  // A run row is written once, after the run ends, so createdAt is when it
  // finished.
  const runRows = db
    .select({
      cardId: schema.ideafySessions.cardId,
      runKind: schema.ideafySessions.runKind,
      at: schema.ideafySessions.createdAt,
    })
    .from(schema.ideafySessions)
    .where(
      and(
        isNotNull(schema.ideafySessions.runKind),
        isNotNull(schema.ideafySessions.cardId),
        gte(schema.ideafySessions.createdAt, since)
      )
    )
    .all();

  // Terminal sessions have their updatedAt refreshed on every turn, so it is
  // the "used today" signal; createdAt may be days old.
  const terminalRows = db
    .select({
      cardId: schema.ideafySessions.cardId,
      at: schema.ideafySessions.updatedAt,
    })
    .from(schema.ideafySessions)
    .where(
      and(
        isNull(schema.ideafySessions.runKind),
        eq(schema.ideafySessions.state, "bound"),
        isNotNull(schema.ideafySessions.cardId),
        gte(schema.ideafySessions.updatedAt, since)
      )
    )
    .all();

  const completionRows = db
    .select({ cardId: schema.cards.id, at: schema.cards.completedAt })
    .from(schema.cards)
    .where(gte(schema.cards.completedAt, since))
    .all();

  const runs = runRows.flatMap((r) =>
    r.cardId && r.runKind ? [{ cardId: r.cardId, runKind: r.runKind, at: r.at }] : []
  );
  const terminals = terminalRows.flatMap((r) =>
    r.cardId ? [{ cardId: r.cardId, at: r.at }] : []
  );
  const completions = completionRows.flatMap((r) =>
    r.at ? [{ cardId: r.cardId, at: r.at }] : []
  );

  // Sessions can outlive their card (no FK), so only ids that still resolve to
  // a card make it into the map, and the grouping drops the rest.
  const cardIds = Array.from(
    new Set([
      ...chats.map((r) => r.cardId),
      ...runs.map((r) => r.cardId),
      ...terminals.map((r) => r.cardId),
      ...completions.map((r) => r.cardId),
    ])
  );
  const projectOf = new Map<string, string | null>();
  if (cardIds.length > 0) {
    const rows = db
      .select({ id: schema.cards.id, projectId: schema.cards.projectId })
      .from(schema.cards)
      .where(inArray(schema.cards.id, cardIds))
      .all();
    for (const row of rows) projectOf.set(row.id, row.projectId);
  }

  const grouped = groupTodayActivity({
    chats: chats.map((r) => ({ ...r, count: Number(r.count) })),
    runs,
    terminals,
    completions,
    projectOf,
  });

  return projectId ? grouped.filter((c) => c.projectId === projectId) : grouped;
}
