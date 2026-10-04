import { Card, CardGroup, Project, ProjectMode, Status } from "./types";
import { isCardInWorkspace, projectModeOf } from "./workspace";
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
 * A column's "Collapse all". Folded is the default, so this creates no state:
 * it drops the exceptions the user opened in that column — every chain row,
 * the Stale row, and the render cap with them, since a column still past its
 * cap after its chains fold would look like the button only did half the job.
 * Other columns keep theirs. Matching on the suffix lives here, next to the
 * key format, so the two change together.
 */
export function collapseColumnFolds(
  expandedGroups: string[],
  uncappedColumns: Status[],
  columnId: Status
): { expandedGroups: string[]; uncappedColumns: Status[] } {
  const suffix = `:${columnId}`;
  return {
    expandedGroups: expandedGroups.filter((key) => !key.endsWith(suffix)),
    uncappedColumns: uncappedColumns.filter((id) => id !== columnId),
  };
}

/**
 * A column's "Expand all", the inverse of the above. The caller passes the
 * keys: a suffix names a column but not the chains in it, and only the rows
 * on screen are worth opening. The cap lifts too, or chains past the seventh
 * row would stay behind "+N more" and the button would only half-expand.
 */
export function expandColumnFolds(
  expandedGroups: string[],
  uncappedColumns: Status[],
  columnId: Status,
  keys: string[]
): { expandedGroups: string[]; uncappedColumns: Status[] } {
  const added = keys.filter(
    (key, i) => !expandedGroups.includes(key) && keys.indexOf(key) === i
  );
  return {
    expandedGroups: added.length > 0 ? [...expandedGroups, ...added] : expandedGroups,
    uncappedColumns: uncappedColumns.includes(columnId)
      ? uncappedColumns
      : [...uncappedColumns, columnId],
  };
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
   * Withdrawn members. Progress reads `done / (total - withdrawn)`: a chain
   * that dropped one of four cards and finished the rest is finished, not
   * stuck at 75%.
   */
  withdrawn: number;
  /** Members in Human Test — not done, but the closest thing to it. */
  inTest: number;
  /** The newest `updatedAt` among the members: when the chain last moved. */
  lastMovedAt: string;
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
    let done = 0;
    let withdrawn = 0;
    let inTest = 0;
    let lastMovedAt = members[0].updatedAt;
    for (const card of members) {
      if (card.status === "completed") done++;
      else if (card.status === "withdrawn") withdrawn++;
      else if (card.status === "test") inTest++;
      if (card.updatedAt > lastMovedAt) lastMovedAt = card.updatedAt;
    }
    summaries.set(group.id, {
      group,
      members,
      total: members.length,
      done,
      withdrawn,
      inTest,
      lastMovedAt,
      nextCard: members.find((card) => !isFinished(card)) ?? null,
      // `done` stays completed-only — it is a progress figure a human reads,
      // and counting withdrawals as progress would flatter the chain.
      isComplete: members.every(isFinished),
    });
  }
  return summaries;
}

/**
 * What the Chains view lists, split the way it draws them: chains that still
 * have a next card on top, the finished ones folded underneath.
 *
 * Scope follows the board. A group tied to a project shows where that project
 * shows; a group with no project shows in whichever workspace — or project —
 * holds at least one of its members, so a cross-project chain appears in both
 * workspaces without ever appearing empty.
 *
 * The query hides chains but never trims one: it matches the code, the name
 * or any member's title, and a match keeps the whole chain, the same rule the
 * board's rollup follows.
 */
export function summarizeChainsForView(
  summaries: Iterable<CardGroupSummary>,
  {
    query = "",
    projectId = null,
    workspace,
    projects,
  }: {
    query?: string;
    projectId?: string | null;
    workspace: ProjectMode;
    projects: Pick<Project, "id" | "mode">[];
  }
): { open: CardGroupSummary[]; finished: CardGroupSummary[] } {
  const needle = query.trim().toLowerCase();

  const inScope = ({ group, members }: CardGroupSummary): boolean => {
    if (group.projectId) {
      return projectId
        ? group.projectId === projectId
        : projectModeOf(group.projectId, projects) === workspace;
    }
    return members.some((card) =>
      projectId
        ? card.projectId === projectId
        : isCardInWorkspace(card, projects, workspace)
    );
  };

  const matches = ({ group, members }: CardGroupSummary): boolean =>
    !needle ||
    group.code.toLowerCase().includes(needle) ||
    group.name.toLowerCase().includes(needle) ||
    members.some((card) => card.title.toLowerCase().includes(needle));

  // Alphabetical stops helping at ten chains; the one that moved last is the
  // one you were just in.
  const byLastMoved = (a: CardGroupSummary, b: CardGroupSummary) =>
    b.lastMovedAt.localeCompare(a.lastMovedAt);

  const visible = [...summaries].filter((s) => inScope(s) && matches(s));
  return {
    open: visible.filter((s) => !s.isComplete).sort(byLastMoved),
    finished: visible.filter((s) => s.isComplete).sort(byLastMoved),
  };
}

/**
 * The open cards a Chains row names: next and up to `size - 1` open members
 * behind it, taken in chain order — never by status, or a chain with three
 * cards in progress would hide which of them is actually next. `more` counts
 * the open members left after the window.
 */
export function chainPillWindow(
  summary: Pick<CardGroupSummary, "members" | "nextCard">,
  size = 4
): { pills: Card[]; more: number } {
  const { members, nextCard } = summary;
  if (!nextCard) return { pills: [], more: 0 };
  const start = members.findIndex((card) => card.id === nextCard.id);
  const open = members.slice(start).filter((card) => !isFinished(card));
  return { pills: open.slice(0, size), more: Math.max(0, open.length - size) };
}

// How far along the board a status sits, for the out-of-order check. Bugs is
// a detour back to planned work, not a step past it.
const STATUS_STAGE: Partial<Record<Status, number>> = {
  ideation: 0,
  backlog: 1,
  bugs: 1,
  progress: 2,
  test: 3,
};

/**
 * The first member behind next in the chain that is already being worked on
 * (In Progress or Human Test) further along than next itself. That is the
 * order and the board disagreeing — either the order is stale or the card
 * jumped the queue — and the row says so in one line. Several cards in
 * progress together is not an anomaly; only a later one being ahead is.
 */
export function chainOrderAnomaly(
  summary: Pick<CardGroupSummary, "members" | "nextCard">
): Card | null {
  const { members, nextCard } = summary;
  if (!nextCard) return null;
  const nextStage = STATUS_STAGE[nextCard.status] ?? 0;
  const start = members.findIndex((card) => card.id === nextCard.id);
  return (
    members
      .slice(start + 1)
      .find(
        (card) =>
          (card.status === "progress" || card.status === "test") &&
          (STATUS_STAGE[card.status] ?? 0) > nextStage
      ) ?? null
  );
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
