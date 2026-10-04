import type { Card, Complexity, Priority } from "./types";

// Priority order: high > medium > low (descending)
const PRIORITY_ORDER: Record<Priority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

// Complexity order: low > medium > high (ascending)
const COMPLEXITY_ORDER: Record<Complexity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

// Newest first. Both sides are ISO strings, so a string compare is enough.
function byNewest(a: Card, b: Card): number {
  return (b.createdAt || "").localeCompare(a.createdAt || "");
}

// Priority (desc), then complexity (asc), then newest. The last key keeps the
// order from depending on the array the store happens to hold: a new card is
// appended client-side, while a reload comes back as taskNumber desc.
function byPriorityThenComplexity(a: Card, b: Card): number {
  const priorityDiff =
    (PRIORITY_ORDER[b.priority] || 2) - (PRIORITY_ORDER[a.priority] || 2);
  if (priorityDiff !== 0) return priorityDiff;

  const complexityDiff =
    (COMPLEXITY_ORDER[a.complexity] || 2) - (COMPLEXITY_ORDER[b.complexity] || 2);
  if (complexityDiff !== 0) return complexityDiff;

  return byNewest(a, b);
}

export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort(byPriorityThenComplexity);
}

// Ideation reads as an inbox: cards nobody has evaluated yet sit on top,
// newest first, because their medium/medium is a default rather than a
// judgement. Evaluated cards follow in the usual priority → complexity order.
// The signal is the opinion text, not aiVerdict: older cards can hold an
// opinion whose verdict marker was never backfilled.
export function sortIdeationCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const aPending = !a.aiOpinion?.trim();
    const bPending = !b.aiOpinion?.trim();
    if (aPending !== bPending) return aPending ? -1 : 1;
    return aPending ? byNewest(a, b) : byPriorityThenComplexity(a, b);
  });
}

// Sort completed cards by completedAt (desc) - most recently completed first
export function sortCompletedCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const dateA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const dateB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return dateB - dateA;
  });
}

// Sort test and withdrawn cards by updatedAt (desc) - most recently updated first
export function sortByRecentUpdate(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const dateA = new Date(a.updatedAt).getTime();
    const dateB = new Date(b.updatedAt).getTime();
    return dateB - dateA;
  });
}
