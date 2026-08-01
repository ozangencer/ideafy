import { Status } from "./types";

/**
 * How long a card may sit in a column before its age is worth pointing out.
 *
 * The number is meaningless without the column. A backlog item resting for a
 * month is a backlog doing its job; a card waiting a month for someone to test
 * it is a card nobody is going to test. Completed and withdrawn cards are done,
 * so their age says nothing and they are left out entirely.
 */
const STALE_AFTER_DAYS: Partial<Record<Status, number>> = {
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
 * The age marker for a card, or null when the age is unremarkable.
 *
 * Returning null for a fresh card is the point: an age shown on every card is
 * noise that makes the genuinely stale ones no easier to spot, which is the
 * problem it was meant to solve.
 *
 * The label is deliberately uniform, with no louder tier for the very oldest.
 * On this board every card in Human Test and In Progress is past its
 * threshold, so an emphasis colour would land on all of them at once and
 * emphasise nothing. The number already separates six months from four.
 */
export function getCardStaleness(
  status: Status,
  createdAt: string | null | undefined,
  now = Date.now()
): CardStaleness | null {
  const threshold = STALE_AFTER_DAYS[status];
  if (threshold === undefined) return null;

  const days = daysSince(createdAt, now);
  if (days === null || days < threshold) return null;

  return { days, label: formatAgeShort(days) };
}
