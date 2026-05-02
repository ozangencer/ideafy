import { ActivityEvent } from "../../types";
import { parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

export const createActivitySlice: StoreSlice<
  Pick<
    KanbanStore,
    | "activityEvents"
    | "activityUnreadCount"
    | "fetchActivity"
    | "fetchActivityUnreadCount"
    | "markActivityRead"
    | "markAllActivityRead"
  >
> = (set, get) => ({
  activityEvents: [],
  activityUnreadCount: 0,

  fetchActivity: async () => {
    try {
      const response = await fetch("/api/activity?limit=50");
      const events = await parseJson<ActivityEvent[]>(response);
      const list = Array.isArray(events) ? events : [];
      set({
        activityEvents: list,
        activityUnreadCount: list.filter((e) => !e.isRead).length,
      });
    } catch (error) {
      console.error("Failed to fetch activity:", error);
    }
  },

  fetchActivityUnreadCount: async () => {
    try {
      const response = await fetch("/api/activity/unread-count");
      const data = await parseJson<{ count: number }>(response);
      set({ activityUnreadCount: typeof data.count === "number" ? data.count : 0 });
    } catch (error) {
      console.error("Failed to fetch activity unread count:", error);
    }
  },

  markActivityRead: async (ids: string[]) => {
    if (!ids.length) return;
    // Optimistic
    set((state) => ({
      activityEvents: state.activityEvents.map((e) =>
        ids.includes(e.id) ? { ...e, isRead: true } : e
      ),
      activityUnreadCount: Math.max(
        0,
        state.activityUnreadCount -
          state.activityEvents.filter((e) => ids.includes(e.id) && !e.isRead).length
      ),
    }));
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

  markAllActivityRead: async () => {
    set((state) => ({
      activityEvents: state.activityEvents.map((e) => ({ ...e, isRead: true })),
      activityUnreadCount: 0,
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
