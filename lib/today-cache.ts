import type { TodayCard } from "@/lib/types";

/**
 * The last Today list per project, kept for the life of the page.
 *
 * Focus view's Today panel used to start empty on every mount and fetch only
 * once it was on screen, so Your turn — computed from the store, synchronously
 * — painted seconds before it. Holding the last answer here lets the panel
 * paint it at once and refresh behind it, and lets the header warm it before
 * Focus is even opened.
 *
 * Client-only and fs-free: it is imported from components, never from the
 * platform layer.
 */
type Entry = { since: string; cards: TodayCard[] };

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<TodayCard[] | null>>();

function keyFor(projectId: string | null): string {
  return projectId ?? "all";
}

export function startOfLocalDay(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * The cached list for this project, or null when there is none for today —
 * a list fetched before midnight belongs to yesterday and is not shown.
 */
export function readToday(projectId: string | null): TodayCard[] | null {
  const entry = cache.get(keyFor(projectId));
  if (!entry || entry.since !== startOfLocalDay().toISOString()) return null;
  return entry.cards;
}

/**
 * Fetch today's list and store it. A second call for the same project and day
 * while one is in flight shares its promise. Resolves to null on failure; the
 * last good list stays in the cache.
 */
export function loadToday(projectId: string | null): Promise<TodayCard[] | null> {
  const since = startOfLocalDay().toISOString();
  const key = `${keyFor(projectId)}|${since}`;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const params = new URLSearchParams({ since });
  if (projectId) params.set("projectId", projectId);
  const request = (async () => {
    try {
      const res = await fetch(`/api/today?${params}`);
      if (!res.ok) return null;
      const json = (await res.json()) as { cards: TodayCard[] };
      cache.set(keyFor(projectId), { since, cards: json.cards });
      return json.cards;
    } catch {
      // Observability, not a critical path.
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, request);
  return request;
}

/** Warm the cache without waiting on it. */
export function prefetchToday(projectId: string | null): void {
  void loadToday(projectId);
}
