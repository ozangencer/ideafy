import { parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";
import { UnifiedItem } from "@/lib/types";

export const createSkillsSlice: StoreSlice<
  Pick<KanbanStore, "skills" | "mcps" | "plugins" | "projectSkills" | "projectMcps" | "fetchSkills" | "fetchMcps" | "fetchPlugins" | "fetchProjectExtensions" | "getUnifiedItems">
> = (set, get) => ({
  skills: [],
  mcps: [],
  plugins: [],
  projectSkills: [],
  projectMcps: [],

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

  fetchProjectExtensions: async (projectId: string | null) => {
    if (!projectId) {
      set({ projectSkills: [], projectMcps: [] });
      return;
    }

    try {
      const [skillsRes, mcpsRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/skills/list`),
        fetch(`/api/projects/${projectId}/mcps/list`),
      ]);

      const [skillsData, mcpsData] = await Promise.all([
        parseJson<{ skills?: string[] }>(skillsRes),
        parseJson<{ mcps?: string[] }>(mcpsRes),
      ]);

      set({
        projectSkills: skillsData.skills || [],
        projectMcps: mcpsData.mcps || [],
      });
    } catch (error) {
      console.error("Failed to fetch project extensions:", error);
      set({ projectSkills: [], projectMcps: [] });
    }
  },

  getUnifiedItems: (): UnifiedItem[] => {
    const state = get();
    const items: UnifiedItem[] = [];
    const addedIds = new Set<string>();

    // Merge global + project skills (dedupe)
    const allSkills = Array.from(new Set([...state.skills, ...state.projectSkills]));
    allSkills.forEach((skill) => {
      if (!addedIds.has(`skill-${skill}`)) {
        addedIds.add(`skill-${skill}`);
        items.push({
          id: skill,
          label: skill,
          type: "skill",
        });
      }
    });

    // Merge global + project MCPs (dedupe)
    const allMcps = Array.from(new Set([...state.mcps, ...state.projectMcps]));
    allMcps.forEach((mcp) => {
      if (!addedIds.has(`mcp-${mcp}`)) {
        addedIds.add(`mcp-${mcp}`);
        items.push({
          id: mcp,
          label: mcp,
          type: "mcp",
        });
      }
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
