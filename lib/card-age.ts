import { Card, StaleThresholds, Status } from "./types";

/**
 * How long a card may go untouched in a column before its age is worth
 * pointing out.
 *
 * The number is meaningless without the column. A backlog item resting for a
 * month is a backlog doing its job; a card waiting a month for someone to test
 * it is a card nobody is going to test. Completed and withdrawn cards are done,
 * so their age says nothing and they are left out entirely.
 *
 * These are the defaults. A column's threshold can be overridden from
 * settings, because the right number depends on how fast the board moves and
 * that is not something a constant can know.
 */
export const DEFAULT_STALE_AFTER_DAYS: StaleThresholds = {
  ideation: 90,
  backlog: 60,
  bugs: 30,
  progress: 14,
  test: 14,
};

const DAY_MS = 86_400_000;

export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

/** Compact age for a card face, where every character competes for room. */
export function formatAgeShort(days: number): string {
  if (days < 7) return `${days}d`;
  if (days < 31) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** Roomier phrasing for tooltips and the card modal. */
export function formatAgeLong(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 31) return `${days} days ago`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export function formatDateShort(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export interface CardStaleness {
  days: number;
  label: string;
}

/**
 * The column's threshold in days, with the user's override applied.
 *
 * A zero or negative override would mark the whole column stale the moment it
 * was typed, which is the one setting no one means; those fall back to the
 * default rather than emptying the board into a Stale box.
 */
export function staleThresholdFor(
  status: Status,
  overrides?: StaleThresholds
): number | undefined {
  const override = overrides?.[status];
  if (typeof override === "number" && Number.isFinite(override) && override >= 1) {
    return Math.floor(override);
  }
  return DEFAULT_STALE_AFTER_DAYS[status];
}

/**
 * When something last happened to this card.
 *
 * This is the signal staleness is built on, and it has to be activity rather
 * than birth. A card opened three months ago and worked on yesterday is not
 * stale by any reading a person would accept, and counting from `createdAt`
 * would sweep it into the Stale box along with the genuinely dead ones —
 * turning a feature meant to surface neglect into one that hides live work.
 */
export function cardLastActivityAt(card: Card): string {
  return card.updatedAt || card.createdAt;
}

/**
 * The age marker for a card, or null when the age is unremarkable.
 *
 * Returning null for a fresh card is the point: an age shown on every card is
 * noise that makes the genuinely stale ones no easier to spot, which is the
 * problem it was meant to solve.
 *
 * The label is deliberately uniform, with no louder tier for the very oldest.
 * Past the threshold a card is already leaving the column's flow for the Stale
 * box, so an emphasis colour would be a second voice saying the same thing.
 * The number already separates six months from four.
 */
export function getCardStaleness(
  status: Status,
  lastActivityAt: string | null | undefined,
  now = Date.now(),
  overrides?: StaleThresholds
): CardStaleness | null {
  const threshold = staleThresholdFor(status, overrides);
  if (threshold === undefined) return null;

  const days = daysSince(lastActivityAt, now);
  if (days === null || days < threshold) return null;

  return { days, label: formatAgeShort(days) };
}

/**
 * A column's stale cards, gathered into the row that sits at its foot.
 *
 * `oldestDays` leads the row rather than an average or the newest: the row
 * exists to say how bad it has got, and one card untouched for eight months is
 * the fact worth reading first.
 */
export interface StaleGroup {
  cards: Card[];
  thresholdDays: number;
  oldestDays: number;
}

/**
 * Splits a column's cards into the ones still in play and the ones that have
 * stopped moving.
 *
 * Pulling the stale ones out is what makes the rest legible: In Progress
 * showing six cards where two have been dead for three months is a column
 * lying about its own load, and no amount of per-card age marking fixes that —
 * the dead cards still occupy the same six slots and the same attention.
 */
export function partitionStaleCards(
  cards: Card[],
  status: Status,
  overrides?: StaleThresholds,
  now = Date.now()
): { live: Card[]; stale: StaleGroup | null } {
  const threshold = staleThresholdFor(status, overrides);
  if (threshold === undefined) return { live: cards, stale: null };

  const live: Card[] = [];
  const staleCards: Card[] = [];
  let oldestDays = 0;

  for (const card of cards) {
    const staleness = getCardStaleness(status, cardLastActivityAt(card), now, overrides);
    if (staleness) {
      staleCards.push(card);
      oldestDays = Math.max(oldestDays, staleness.days);
    } else {
      live.push(card);
    }
  }

  return {
    live,
    stale: staleCards.length
      ? { cards: staleCards, thresholdDays: threshold, oldestDays }
      : null,
  };
}
