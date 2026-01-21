import { AppSettings } from "../../types";
import { parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

export const createSettingsSlice: StoreSlice<
  Pick<KanbanStore, "settings" | "isSettingsLoading" | "fetchSettings" | "updateSettings">
> = (set, get) => ({
  settings: null,
  isSettingsLoading: false,

  fetchSettings: async () => {
    set({ isSettingsLoading: true });
    try {
      const response = await fetch("/api/settings");
      const settings = await parseJson<AppSettings>(response);
      set({ settings, isSettingsLoading: false });
    } catch (error) {
      console.error("Failed to fetch settings:", error);
      set({ isSettingsLoading: false });
    }
  },

  updateSettings: async (updates) => {
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const settings = await parseJson<AppSettings>(response);
      set({ settings });

      if (updates.skillsPath) {
        get().fetchSkills();
      }
      if (updates.mcpConfigPath) {
        get().fetchMcps();
      }
    } catch (error) {
      console.error("Failed to update settings:", error);
    }
  },
});
