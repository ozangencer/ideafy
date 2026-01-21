import { parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";
import { UnifiedItem } from "@/lib/types";

export const createSkillsSlice: StoreSlice<
  Pick<KanbanStore, "skills" | "mcps" | "plugins" | "fetchSkills" | "fetchMcps" | "fetchPlugins" | "getUnifiedItems">
> = (set, get) => ({
  skills: [],
  mcps: [],
  plugins: [],

  fetchSkills: async () => {
    try {
      const response = await fetch("/api/skills");
      const data = await parseJson<{ skills?: string[] }>(response);
      set({ skills: data.skills || [] });
    } catch (error) {
      console.error("Failed to fetch skills:", error);
    }
  },

  fetchMcps: async () => {
    try {
      const response = await fetch("/api/mcps");
      const data = await parseJson<{ mcps?: string[] }>(response);
      set({ mcps: data.mcps || [] });
    } catch (error) {
      console.error("Failed to fetch MCPs:", error);
    }
  },

  fetchPlugins: async () => {
    // Plugins are future feature - return empty for now
    set({ plugins: [] });
  },

  getUnifiedItems: (): UnifiedItem[] => {
    const state = get();
    const items: UnifiedItem[] = [];

    // Add skills
    state.skills.forEach((skill) => {
      items.push({
        id: skill,
        label: skill,
        type: "skill",
      });
    });

    // Add MCPs
    state.mcps.forEach((mcp) => {
      items.push({
        id: mcp,
        label: mcp,
        type: "mcp",
      });
    });

    // Add plugins (future)
    state.plugins.forEach((plugin) => {
      items.push({
        id: plugin,
        label: plugin,
        type: "plugin",
      });
    });

    return items;
  },
});
