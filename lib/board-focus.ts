/**
 * Who the board is waiting on.
 *
 * The columns answer "what is there". They cannot answer "whose turn is it",
 * because six cards in In Progress look identical while meaning opposite
 * things: one has an agent running in it right now, one was finished by the
 * agent hours ago and is waiting for a human to read it, one has been dead for
 * three months.
 *
 * Every state below is *derived*. Nothing here is stored on a card, and that is
 * deliberate: a `focusState` column would be one more field to keep in sync
 * with every status change, every run, every merge — and it would be wrong the
 * moment any of those happened outside the app. The five fields it reads
 * (`processingType`, `rebaseConflict`, `status`, `aiVerdict`, `updatedAt`) are
 * already maintained for their own reasons.
 */

import { cardLastActivityAt, formatAgeShort, partitionStaleCards } from "./card-age";
import { SECTION_LABEL } from "./process-labels";
import { parseTestProgress } from "./test-progress";
import {
  ActivityEvent,
  ActivityType,
  Card,
  COLUMNS,
  getColumns,
  ProjectMode,
  SectionType,
  StaleThresholds,
  Status,
} from "./types";

export type FocusState =
  | "blocked"
  | "your-reply"
  | "your-review"
  | "your-test"
  | "your-decision"
  | "agent-running"
  | "waiting";

/** The states that put a card in front of you, in the order they earn attention. */
const YOUR_TURN_ORDER: FocusState[] = [
  "blocked",
  // A conversation waiting on your answer loses its context the longer it
  // waits, so it outranks a finished run that will read the same tomorrow.
  "your-reply",
  "your-review",
  "your-test",
  "your-decision",
];

export function isYourTurn(state: FocusState): boolean {
  return YOUR_TURN_ORDER.includes(state);
}

const isFinished = (status: Status): boolean =>
  status === "completed" || status === "withdrawn";

/**
 * A running agent wins over a conflict. Both can be true at once — a merge
 * left a conflict and a new run started on top of it — and while the run is in
 * flight there is nothing for a human to resolve; interrupting it is how you
 * get a half-applied merge.
 */
export function getFocusState(card: Card): FocusState {
  if (isFinished(card.status)) return "waiting";
  if (card.processingType) return "agent-running";
  if (card.rebaseConflict) return "blocked";
  if (card.status === "progress") return "your-review";
  if (card.status === "test") return "your-test";
  if (card.status === "ideation" && card.aiVerdict) return "your-decision";
  return "waiting";
}

export interface FocusStateStyle {
  /** The row's leading icon, by lucide name. */
  icon: "AlertTriangle" | "Check" | "FlaskConical" | "Lightbulb" | "MessageSquare";
  /** Tailwind text colour for the icon. */
  color: string;
  /** The row's action button. */
  action: string;
  /** Which tab of the card modal that action should land on. */
  section: SectionType;
}

/**
 * The four states differ in colour as well as verb because a list of fifteen
 * rows is scanned, not read: the colour sorts them before any word is parsed,
 * and the verb says what the click will cost you.
 */
export const FOCUS_STATE_STYLES: Record<
  "blocked" | "your-reply" | "your-review" | "your-test" | "your-decision",
  FocusStateStyle
> = {
  blocked: {
    icon: "AlertTriangle",
    color: "text-red-500",
    action: "Resolve",
    section: "detail",
  },
  // The section is only a fallback: the row opens the tab the reply landed
  // on, which it reads from `row.reply.section`.
  "your-reply": {
    icon: "MessageSquare",
    color: "text-amber-500",
    action: "Reply",
    section: "detail",
  },
  "your-review": {
    icon: "Check",
    color: "text-green-500",
    action: "Review",
    section: "solution",
  },
  "your-test": {
    icon: "FlaskConical",
    color: "text-blue-500",
    action: "Test",
    section: "tests",
  },
  "your-decision": {
    icon: "Lightbulb",
    color: "text-purple-500",
    action: "Decide",
    section: "opinion",
  },
};

/** What a running agent is doing, in the words the card actually carries. */
const PROCESSING_LABELS: Record<string, string> = {
  autonomous: "running autonomously",
  "quick-fix": "quick fix",
  evaluate: "evaluating",
  generate: "generating",
};

/**
 * Time since the last activity, down to the hour.
 *
 * `formatAgeShort` starts at whole days, and "0d" is a poor answer to "when
 * did the agent finish" for the case this list exists to serve — the run that
 * ended while you were at lunch.
 */
export function formatSince(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "unknown";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";

  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${formatAgeShort(Math.floor(hours / 24))} ago`;
}

/**
 * The mono line under a focus row's title: the one fact that decides whether
 * you click it now or later.
 *
 * It is deliberately specific per state. "3 days ago" under every row would be
 * a timestamp column, and a timestamp does not tell you that four of five core
 * checks already passed and only one is left for you.
 */
export function focusDetail(
  card: Card,
  now = Date.now(),
  state: FocusState = getFocusState(card),
  reply?: UnreadReply
): string {
  switch (state) {
    case "blocked": {
      const files = card.conflictFiles?.length ?? 0;
      return files > 0
        ? `rebase conflict · ${files} file${files === 1 ? "" : "s"}`
        : "rebase conflict";
    }

    case "your-review": {
      // A worktree only exists because a run created one, so its presence is
      // the honest way to say an agent has been here — as opposed to a card
      // dragged into In Progress by hand, which nobody has worked on yet.
      const agentRan = card.gitWorktreeStatus === "active";
      return `${agentRan ? "agent done" : "in progress"} · ${formatSince(
        cardLastActivityAt(card),
        now
      )}`;
    }

    case "your-test": {
      const progress = parseTestProgress(card.testScenarios);
      if (!progress) return `no checklist yet · ${formatSince(cardLastActivityAt(card), now)}`;

      if (progress.core) {
        const left = progress.core.total - progress.core.checked;
        if (left > 0) {
          return `${progress.core.checked}/${progress.core.total} core ✓ · ${left} left for you`;
        }
        const optionalLeft =
          progress.total - progress.core.total - (progress.checked - progress.core.checked);
        return optionalLeft > 0
          ? `core flow done · ${optionalLeft} optional left`
          : "core flow done";
      }

      const left = progress.total - progress.checked;
      return left > 0
        ? `${progress.checked}/${progress.total} checked · ${left} left for you`
        : `${progress.checked}/${progress.total} checked`;
    }

    case "your-reply":
      return reply
        ? replyLine(reply, now)
        : `new reply · ${formatSince(cardLastActivityAt(card), now)}`;

    case "your-decision":
      return card.aiVerdict === "positive"
        ? "verdict: yes · move to backlog?"
        : "verdict: no · withdraw?";

    case "agent-running":
      return `${PROCESSING_LABELS[card.processingType ?? ""] ?? "running"} · started ${formatSince(
        cardLastActivityAt(card),
        now
      )}`;

    default:
      return formatSince(cardLastActivityAt(card), now);
  }
}

/**
 * A chat answer on a card that you have not opened since it landed.
 *
 * It lives in `activity_events`, not on the card, which is why it reaches
 * `buildFocusBoard` as a parameter instead of through `getFocusState`.
 */
export interface UnreadReply {
  /** The tab the conversation happened on, so the row can open it there. */
  section: SectionType;
  at: string;
  /** The turn died. Still your move — read why and ask again. */
  failed: boolean;
}

const CHAT_SECTIONS: Partial<Record<ActivityType, SectionType>> = {
  "chat-detail": "detail",
  "chat-opinion": "opinion",
  "chat-solution": "solution",
  "chat-tests": "tests",
};

/**
 * Unread chat replies, one per card, the newest winning.
 *
 * Only `chat-*`: a finished opinion or plan already puts the card in front of
 * you as a decision or a review, and a second signal for the same event would
 * only teach you to ignore one of them.
 */
export function unreadRepliesByCard(events: ActivityEvent[]): Map<string, UnreadReply> {
  const replies = new Map<string, UnreadReply>();
  for (const event of events) {
    if (event.isRead || !event.cardId) continue;
    const section = CHAT_SECTIONS[event.type];
    if (!section) continue;

    const previous = replies.get(event.cardId);
    if (previous && previous.at >= event.updatedAt) continue;
    replies.set(event.cardId, {
      section,
      at: event.updatedAt,
      failed: event.payload?.failed === true,
    });
  }
  return replies;
}

/** "new reply · Solution · 12m ago" — the line a reply adds under its row. */
export function replyLine(reply: UnreadReply, now = Date.now()): string {
  return `${reply.failed ? "reply failed" : "new reply"} · ${
    SECTION_LABEL[reply.section]
  } · ${formatSince(reply.at, now)}`;
}

export interface FocusRow {
  card: Card;
  state: Exclude<FocusState, "agent-running" | "waiting">;
  /**
   * An unread chat reply on a card that is in Your turn for its own reason.
   * The row keeps its action; the reply rides along beneath it.
   */
  reply?: UnreadReply;
}

export interface WaitingBucket {
  status: Status;
  title: string;
  count: number;
}

export interface FocusBoard {
  yourTurn: FocusRow[];
  agentRunning: Card[];
  waiting: {
    /** Includes `stale`, so the heading equals the sum of the line beneath it. */
    total: number;
    buckets: WaitingBucket[];
    /**
     * Listed beside the columns rather than inside one: a stale card is a
     * decision to make, not a queue to work through, and it has left its
     * column's flow for the row at the column's foot.
     */
    stale: number;
  };
}

const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/**
 * The three blocks, from the same filtered card list the board renders.
 *
 * Stale cards are held out of Your turn on purpose. A card nobody has touched
 * in three months is not a task you forgot to do this morning; putting it in
 * the same list would make the list unreliable, and an unreliable "your turn"
 * gets ignored wholesale. It is counted once, at the end, next to the columns.
 *
 * An unread chat reply lifts an otherwise waiting card into Your turn: someone
 * answered you, so the next move is yours whatever column the card sits in.
 */
export function buildFocusBoard(
  cards: Card[],
  staleThresholds?: StaleThresholds,
  now = Date.now(),
  mode: ProjectMode = "development",
  unreadReplies: Map<string, UnreadReply> = new Map()
): FocusBoard {
  const yourTurn: FocusRow[] = [];
  const agentRunning: Card[] = [];
  const waitingByStatus = new Map<Status, number>();
  let stale = 0;

  for (const column of COLUMNS) {
    if (isFinished(column.id)) continue;

    const columnCards = cards.filter((card) => card.status === column.id);
    const { live, stale: staleGroup } = partitionStaleCards(
      columnCards,
      column.id,
      staleThresholds,
      now
    );
    stale += staleGroup?.cards.length ?? 0;

    for (const card of live) {
      const state = getFocusState(card);
      const reply = unreadReplies.get(card.id);
      if (state === "agent-running") {
        agentRunning.push(card);
      } else if (state === "waiting") {
        if (reply) {
          yourTurn.push({ card, state: "your-reply", reply });
        } else {
          waitingByStatus.set(column.id, (waitingByStatus.get(column.id) ?? 0) + 1);
        }
      } else {
        yourTurn.push(reply ? { card, state, reply } : { card, state });
      }
    }
  }

  yourTurn.sort((a, b) => {
    const stateDiff = YOUR_TURN_ORDER.indexOf(a.state) - YOUR_TURN_ORDER.indexOf(b.state);
    if (stateDiff !== 0) return stateDiff;

    const priorityDiff =
      (PRIORITY_RANK[b.card.priority] ?? 2) - (PRIORITY_RANK[a.card.priority] ?? 2);
    if (priorityDiff !== 0) return priorityDiff;

    // Most recently touched first: the thing you were in the middle of is the
    // thing you are most likely coming back to.
    return (
      new Date(cardLastActivityAt(b.card)).getTime() -
      new Date(cardLastActivityAt(a.card)).getTime()
    );
  });

  const buckets = getColumns(mode).filter((column) => waitingByStatus.has(column.id)).map((column) => ({
    status: column.id,
    title: column.title,
    count: waitingByStatus.get(column.id) ?? 0,
  }));

  return {
    yourTurn,
    agentRunning,
    waiting: {
      total: buckets.reduce((sum, bucket) => sum + bucket.count, 0) + stale,
      buckets,
      stale,
    },
  };
}
