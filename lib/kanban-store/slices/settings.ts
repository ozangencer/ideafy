import type { AiPlatform, AppSettings } from "../../types";
import { parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

// Client-safe platform defaults (no fs imports)
const PLATFORM_DEFAULTS: Record<AiPlatform, { skillsPath: string; mcpConfigPath: string }> = {
  claude: { skillsPath: "~/.claude/skills", mcpConfigPath: "~/.claude.json" },
  gemini: { skillsPath: "~/.gemini/skills", mcpConfigPath: "~/.gemini/settings.json" },
  codex: { skillsPath: "~/.codex/skills", mcpConfigPath: "~/.codex/config.toml" },
};

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
      // When platform changes, update default paths
      if (updates.aiPlatform) {
        const newDefaults = PLATFORM_DEFAULTS[updates.aiPlatform];
        const currentSettings = get().settings;

        if (currentSettings) {
          const oldDefaults = PLATFORM_DEFAULTS[currentSettings.aiPlatform];
          // Only update paths if they were at the old platform's defaults
          if (currentSettings.skillsPath === oldDefaults.skillsPath) {
            updates.skillsPath = newDefaults.skillsPath;
          }
          if (currentSettings.mcpConfigPath === oldDefaults.mcpConfigPath) {
            updates.mcpConfigPath = newDefaults.mcpConfigPath;
          }
        }
      }

      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const settings = await parseJson<AppSettings>(response);
      set({ settings });

      // Re-fetch extensions when relevant paths or platform change
      if (updates.skillsPath || updates.aiPlatform) {
        get().fetchSkills();
      }
      if (updates.mcpConfigPath || updates.aiPlatform) {
        get().fetchMcps();
      }
      if (updates.aiPlatform) {
        get().fetchAgents();
      }
      if (updates.aiPlatform) {
        const activeProjectId = get().activeProjectId;
        if (activeProjectId) {
          get().fetchProjectExtensions(activeProjectId);
        }
      }
    } catch (error) {
      console.error("Failed to update settings:", error);
    }
  },
});
