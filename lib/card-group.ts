import { Card, CardGroup, Status } from "./types";
import { compareByChainOrder, isFinished } from "./chain-order";

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
 * The reserved id for a column's Stale row, which folds through the same
 * `expandedGroups` set as a real chain.
 *
 * The (group, column) decision above applies to it unchanged, and more
 * plainly: a Stale row is column-local by construction — each column has its
 * own threshold, so "the stale cards" is a different set in Backlog than in
 * In Progress. Real group ids are UUIDs, so this cannot collide with one.
 */
export const STALE_GROUP_ID = "stale";

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
   * completed nor withdrawn, in chain order. Null once the chain is done.
   */
  nextCard: Card | null;
  /**
   * True when no member is still moving — every one completed or withdrawn —
   * and the group leaves the board. Deliberately not `done === total`:
   * withdrawing the last open card of a chain ends it just as surely as
   * finishing it, and a chain that ends 3/4 has to be able to leave too.
   * Otherwise its row sits in Completed forever, reading as unfinished work
   * with no next card to point at.
   */
  isComplete: boolean;
}

// The ordering itself lives in an import-free module so the MCP server can
// carry a verbatim copy of it; re-exported here so the board keeps one import.
export {
  buildChainContext,
  compareByChainOrder,
  isFinished,
  placeAfter,
  type ChainCardRef,
  type ChainContext,
} from "./chain-order";

/**
 * Members ahead of `card` in the chain that are still open. What the start
 * warning names: a finished predecessor is done with, so it is no reason to
 * pause. A card sitting in Human Test is not finished and still counts.
 */
export function openPredecessors(members: Card[], card: Pick<Card, "id">): Card[] {
  const ordered = [...members].sort(compareByChainOrder);
  const index = ordered.findIndex((member) => member.id === card.id);
  if (index <= 0) return [];
  return ordered.slice(0, index).filter((member) => !isFinished(member));
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
    const members = (byGroup.get(group.id) ?? []).sort(compareByChainOrder);
    if (members.length === 0) continue;
    const done = members.filter((card) => card.status === "completed").length;
    summaries.set(group.id, {
      group,
      members,
      total: members.length,
      done,
      nextCard: members.find((card) => !isFinished(card)) ?? null,
      // `done` stays completed-only — it is a progress figure a human reads,
      // and counting withdrawals as progress would flatter the chain.
      isComplete: members.every(isFinished),
    });
  }
  return summaries;
}

export type ColumnRow =
  | { kind: "card"; card: Card }
  | {
      kind: "group";
      summary: CardGroupSummary;
      /**
       * This column's members, in chain order. Filtered from the column's
       * list so its filters still apply, but not in its priority order: the
       * header names a "next" by chain order, and members listed by priority
       * right under it put two orders on one row.
       */
      columnMembers: Card[];
    };

/**
 * Turns a column's already-sorted card list into rows, folding each group into
 * a single entry that sits where its first member fell in the column's sort. Groups
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

    const columnMembers = sortedCards
      .filter((c) => c.groupId === summary.group.id)
      .sort(compareByChainOrder);
    rows.push({ kind: "group", summary, columnMembers });
  }

  return rows;
}
