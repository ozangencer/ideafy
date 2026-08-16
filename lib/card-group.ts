import { Card, CardGroup, Status } from "./types";

/**
 * Fold state is per (group, column), not per group. A chain spreads across
 * columns and gets its own row in each one, and everything else about that row
 * is already column-local — the "N collapsed" count, the "+N more" button, the
 * row itself. Unfolding in Backlog to see six cards has no business unfolding
 * eight more in Ideation, off-screen, which is the density problem coming back
 * by another door. What you want across columns the row already tells you:
 * the rollup and the next card.
 */
export function groupFoldKey(groupId: string, columnId: Status): string {
  return `${groupId}:${columnId}`;
}

/**
 * Everything the board needs to know about a group, all of it derived. Nothing
 * here is stored: a rollup column would have to be kept in sync with every
 * status change, and the count is one filter away from the cards we already
 * hold.
 */
export interface CardGroupSummary {
  group: CardGroup;
  /** Every member on the board, board-wide — not just one column's worth. */
  members: Card[];
  total: number;
  done: number;
  /**
   * The chain's next actionable card: the first member that is neither
   * completed nor withdrawn, in taskNumber order. Null once the chain is done.
   */
  nextCard: Card | null;
  /** True when every member is completed — the group leaves the board. */
  isComplete: boolean;
}

const isFinished = (card: Card): boolean =>
  card.status === "completed" || card.status === "withdrawn";

/**
 * taskNumber order is the chain order: a chain is written in one sitting, so
 * the numbers come out in dependency order. Cards without a number (drafts)
 * sort last rather than winning the "next" slot with a 0.
 */
export function compareByTaskNumber(a: Card, b: Card): number {
  const an = a.taskNumber ?? Number.MAX_SAFE_INTEGER;
  const bn = b.taskNumber ?? Number.MAX_SAFE_INTEGER;
  return an - bn;
}

/**
 * Members are collected from the WHOLE board, not from the column being
 * rendered. A chain spreads across columns as it progresses, and that is
 * exactly where the rollup earns its keep: the Backlog row can say 3/14 while
 * only 8 of those cards are in Backlog.
 */
export function summarizeCardGroups(
  cards: Card[],
  groups: CardGroup[]
): Map<string, CardGroupSummary> {
  const byGroup = new Map<string, Card[]>();
  for (const card of cards) {
    if (!card.groupId) continue;
    const bucket = byGroup.get(card.groupId);
    if (bucket) bucket.push(card);
    else byGroup.set(card.groupId, [card]);
  }

  const summaries = new Map<string, CardGroupSummary>();
  for (const group of groups) {
    const members = (byGroup.get(group.id) ?? []).sort(compareByTaskNumber);
    if (members.length === 0) continue;
    const done = members.filter((card) => card.status === "completed").length;
    summaries.set(group.id, {
      group,
      members,
      total: members.length,
      done,
      nextCard: members.find((card) => !isFinished(card)) ?? null,
      isComplete: done === members.length,
    });
  }
  return summaries;
}

export type ColumnRow =
  | { kind: "card"; card: Card }
  | {
      kind: "group";
      summary: CardGroupSummary;
      /** This column's members, in the column's own sort order. */
      columnMembers: Card[];
    };

/**
 * Turns a column's already-sorted card list into rows, folding each group into
 * a single entry that sits where its first member fell in the sort. Groups
 * whose chain is finished get no row at all — a done chain has nothing left to
 * say, and its cards are ordinary Completed cards from then on.
 *
 * Folded means folded: no member renders. An earlier cut kept the chain's next
 * card visible under a closed row, which read as a disclosure control with a
 * child still showing — and left two controls (the chevron and "+N more") for
 * one job. What the next card was there to answer, the row answers in text.
 */
export function buildColumnRows(
  sortedCards: Card[],
  summaries: Map<string, CardGroupSummary>
): ColumnRow[] {
  const rows: ColumnRow[] = [];
  const seenGroups = new Set<string>();

  for (const card of sortedCards) {
    const summary = card.groupId ? summaries.get(card.groupId) : undefined;
    if (!summary || summary.isComplete) {
      rows.push({ kind: "card", card });
      continue;
    }
    if (seenGroups.has(summary.group.id)) continue;
    seenGroups.add(summary.group.id);

    const columnMembers = sortedCards.filter((c) => c.groupId === summary.group.id);
    rows.push({ kind: "group", summary, columnMembers });
  }

  return rows;
}
