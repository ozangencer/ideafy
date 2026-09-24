import { ActivityEvent } from "../../types";
import { parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

// Badge count: unread events that landed after the user last opened the bell.
// The row dot stays on isRead alone, so "seen" and "read" stay independent.
function countUnseen(events: ActivityEvent[], lastSeenAt: string | null): number {
  return events.filter((e) => !e.isRead && (!lastSeenAt || e.updatedAt > lastSeenAt)).length;
}

function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export const createActivitySlice: StoreSlice<
  Pick<
    KanbanStore,
    | "activityEvents"
    | "activityUnreadCount"
    | "activityUnseenCount"
    | "activityLastSeenAt"
    | "fetchActivity"
    | "fetchActivityUnreadCount"
    | "markActivityRead"
    | "markActivityReadForCard"
    | "markActivitySeen"
    | "markAllActivityRead"
  >
> = (set, get) => ({
  activityEvents: [],
  activityUnreadCount: 0,
  activityUnseenCount: 0,
  activityLastSeenAt: null,

  fetchActivity: async () => {
    try {
      const [eventsResponse, countResponse] = await Promise.all([
        fetch("/api/activity?limit=50"),
        fetch("/api/activity/unread-count"),
      ]);
      const events = await parseJson<ActivityEvent[]>(eventsResponse);
      const counts = await parseJson<{ lastSeenAt?: string | null }>(countResponse);
      const list = Array.isArray(events) ? events : [];
      // Never let a poll that raced an in-flight "seen" POST move the
      // watermark backwards and resurrect the badge.
      const lastSeenAt = laterOf(get().activityLastSeenAt, counts?.lastSeenAt ?? null);
      set({
        activityEvents: list,
        activityUnreadCount: list.filter((e) => !e.isRead).length,
        activityUnseenCount: countUnseen(list, lastSeenAt),
        activityLastSeenAt: lastSeenAt,
      });
    } catch (error) {
      console.error("Failed to fetch activity:", error);
    }
  },

  fetchActivityUnreadCount: async () => {
    try {
      const response = await fetch("/api/activity/unread-count");
      const data = await parseJson<{
        count: number;
        unseenCount?: number;
        lastSeenAt?: string | null;
      }>(response);
      set({
        activityUnreadCount: typeof data.count === "number" ? data.count : 0,
        activityUnseenCount: typeof data.unseenCount === "number" ? data.unseenCount : 0,
        activityLastSeenAt: laterOf(get().activityLastSeenAt, data.lastSeenAt ?? null),
      });
    } catch (error) {
      console.error("Failed to fetch activity unread count:", error);
    }
  },

  markActivitySeen: async () => {
    const { activityEvents, activityLastSeenAt } = get();
    // Use the newest event the client has actually shown, not "now": an
    // event created between the fetch and this POST must stay unseen.
    const newest = activityEvents.reduce<string | null>(
      (max, e) => laterOf(max, e.updatedAt),
      null
    );
    if (!newest || (activityLastSeenAt && activityLastSeenAt >= newest)) {
      set({ activityUnseenCount: 0 });
      return;
    }
    set({ activityUnseenCount: 0, activityLastSeenAt: newest });
    try {
      await fetch("/api/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seenUpTo: newest }),
      });
    } catch (error) {
      console.error("Failed to mark activity seen:", error);
    }
  },

  markActivityRead: async (ids: string[]) => {
    if (!ids.length) return;
    // Optimistic
    set((state) => {
      const activityEvents = state.activityEvents.map((e) =>
        ids.includes(e.id) ? { ...e, isRead: true } : e
      );
      return {
        activityEvents,
        activityUnreadCount: Math.max(
          0,
          state.activityUnreadCount -
            state.activityEvents.filter((e) => ids.includes(e.id) && !e.isRead).length
        ),
        activityUnseenCount: countUnseen(activityEvents, state.activityLastSeenAt),
      };
    });
    try {
      await fetch("/api/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    } catch (error) {
      console.error("Failed to mark activity read:", error);
      get().fetchActivity();
    }
  },

  markActivityReadForCard: async (cardId: string) => {
    set((state) => {
      const activityEvents = state.activityEvents.map((e) =>
        e.cardId === cardId && !e.isRead ? { ...e, isRead: true } : e
      );
      return {
        activityEvents,
        activityUnreadCount: Math.max(
          0,
          state.activityUnreadCount -
            state.activityEvents.filter((e) => e.cardId === cardId && !e.isRead).length
        ),
        activityUnseenCount: countUnseen(activityEvents, state.activityLastSeenAt),
      };
    });
    try {
      await fetch("/api/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId }),
      });
    } catch (error) {
      console.error("Failed to mark card activity read:", error);
      get().fetchActivity();
    }
  },

  markAllActivityRead: async () => {
    set((state) => ({
      activityEvents: state.activityEvents.map((e) => ({ ...e, isRead: true })),
      activityUnreadCount: 0,
      activityUnseenCount: 0,
      activityLastSeenAt: laterOf(state.activityLastSeenAt, new Date().toISOString()),
    }));
    try {
      await fetch("/api/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch (error) {
      console.error("Failed to mark all activity read:", error);
      get().fetchActivity();
    }
  },
});
