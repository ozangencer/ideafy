import { parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

export const createSkillsSlice: StoreSlice<
  Pick<KanbanStore, "skills" | "mcps" | "fetchSkills" | "fetchMcps">
> = (set) => ({
  skills: [],
  mcps: [],

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
});
