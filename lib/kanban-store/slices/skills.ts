import { parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";
import {
  buildSkillGroupUnifiedItems,
  normalizeGroupName,
} from "@/lib/skills/grouping";
import {
  SkillGroupCollectionsResponse,
  SkillListItem,
  SkillPreview,
  UnifiedItem,
} from "@/lib/types";

export const createSkillsSlice: StoreSlice<
  Pick<KanbanStore, "skills" | "skillItems" | "projectSkillItems" | "selectedSkill" | "isSkillViewerOpen" | "globalSkillGroups" | "projectSkillGroups" | "mcps" | "agents" | "plugins" | "projectSkills" | "projectMcps" | "projectAgents" | "fetchSkills" | "fetchSkillGroups" | "openSkillPreview" | "closeSkillViewer" | "createSkillGroup" | "renameSkillGroup" | "deleteSkillGroup" | "moveSkillToGroup" | "fetchMcps" | "fetchAgents" | "fetchPlugins" | "fetchProjectExtensions" | "getUnifiedItems">
> = (set, get) => ({
  skills: [],
  skillItems: [],
  projectSkillItems: [],
  selectedSkill: null,
  isSkillViewerOpen: false,
  globalSkillGroups: [],
  projectSkillGroups: {},
  mcps: [],
  agents: [],
  plugins: [],
  projectSkills: [],
  projectMcps: [],
  projectAgents: [],

  fetchSkills: async () => {
    try {
      const response = await fetch("/api/skills");
      const data = await parseJson<{ skills?: string[]; items?: SkillListItem[] }>(response);
      set({
        skills: data.skills || [],
        skillItems: data.items || [],
      });
      await get().fetchSkillGroups();
    } catch (error) {
      console.error("Failed to fetch skills:", error);
      set({ skills: [], skillItems: [] });
    }
  },

  fetchSkillGroups: async () => {
    try {
      const response = await fetch("/api/skill-groups");
      const data = await parseJson<SkillGroupCollectionsResponse>(response);
      if (!response.ok) return;

      set({
        globalSkillGroups: Array.isArray(data.globalGroups) ? data.globalGroups : [],
        projectSkillGroups:
          data.projectGroups && typeof data.projectGroups === "object"
            ? data.projectGroups
            : {},
      });
    } catch (error) {
      console.error("Failed to fetch skill groups:", error);
    }
  },

  openSkillPreview: async (skill) => {
    try {
      const response = await fetch(
        `/api/skills/content?path=${encodeURIComponent(skill.path)}`
      );
      const data = await parseJson<SkillPreview>(response);
      if (!response.ok || typeof data.bodyContent !== "string") return;

      set({
        selectedSkill: {
          ...skill,
          rawContent: data.rawContent || "",
          bodyContent: data.bodyContent || "",
          frontmatter: data.frontmatter || {},
          firstHeading: data.firstHeading ?? null,
          title: data.title || skill.title,
          group: data.group ?? skill.group,
          description: data.description ?? skill.description,
          source: data.source || skill.source,
        },
        isSkillViewerOpen: true,
      });
    } catch (error) {
      console.error("Failed to open skill:", error);
    }
  },

  closeSkillViewer: () => {
    set({
      selectedSkill: null,
      isSkillViewerOpen: false,
    });
  },

  createSkillGroup: async (name, source, projectId) => {
    const normalizedName = normalizeGroupName(name);
    if (!normalizedName) return null;

    try {
      const response = await fetch("/api/skill-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: normalizedName,
          source,
          projectId: source === "project" ? projectId : null,
        }),
      });
      const data = await parseJson<{ groupId?: string }>(response);
      if (!response.ok || typeof data.groupId !== "string") return null;

      await get().fetchSkillGroups();
      return data.groupId;
    } catch (error) {
      console.error("Failed to create skill group:", error);
      return null;
    }
  },

  renameSkillGroup: async (groupId, name, source, projectId) => {
    const normalizedName = normalizeGroupName(name);
    if (!normalizedName) return;

    try {
      const response = await fetch(`/api/skill-groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: normalizedName,
          source,
          projectId: source === "project" ? projectId : null,
        }),
      });
      if (!response.ok) return;
      await get().fetchSkillGroups();
    } catch (error) {
      console.error("Failed to rename skill group:", error);
    }
  },

  deleteSkillGroup: async (groupId) => {
    try {
      const response = await fetch(`/api/skill-groups/${groupId}`, {
        method: "DELETE",
      });
      if (!response.ok) return;
      await get().fetchSkillGroups();
    } catch (error) {
      console.error("Failed to delete skill group:", error);
    }
  },

  moveSkillToGroup: async (skillName, groupId, source, projectId) => {
    try {
      const response = await fetch("/api/skill-groups", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillName,
          groupId,
          source,
          projectId: source === "project" ? projectId : null,
        }),
      });
      if (!response.ok) return;
      await get().fetchSkillGroups();
    } catch (error) {
      console.error("Failed to move skill to group:", error);
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

  fetchAgents: async () => {
    try {
      const response = await fetch("/api/agents");
      const data = await parseJson<{ agents?: string[] }>(response);
      set({ agents: data.agents || [] });
    } catch (error) {
      console.error("Failed to fetch agents:", error);
    }
  },

  fetchPlugins: async () => {
    // Plugins are future feature - return empty for now
    set({ plugins: [] });
  },

  fetchProjectExtensions: async (projectId: string | null) => {
    if (!projectId) {
      set({
        projectSkills: [],
        projectSkillItems: [],
        projectMcps: [],
        projectAgents: [],
      });
      return;
    }

    try {
      const [skillsRes, mcpsRes, agentsRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/skills/list`),
        fetch(`/api/projects/${projectId}/mcps/list`),
        fetch(`/api/projects/${projectId}/agents/list`),
      ]);

      const [skillsData, mcpsData, agentsData] = await Promise.all([
        parseJson<{ skills?: string[]; items?: SkillListItem[] }>(skillsRes),
        parseJson<{ mcps?: string[] }>(mcpsRes),
        parseJson<{ agents?: string[] }>(agentsRes),
      ]);

      set({
        projectSkills: skillsData.skills || [],
        projectSkillItems: skillsData.items || [],
        projectMcps: mcpsData.mcps || [],
        projectAgents: agentsData.agents || [],
      });
    } catch (error) {
      console.error("Failed to fetch project extensions:", error);
      set({
        projectSkills: [],
        projectSkillItems: [],
        projectMcps: [],
        projectAgents: [],
      });
    }
  },

  getUnifiedItems: (): UnifiedItem[] => {
    const state = get();
    const items: UnifiedItem[] = [];
    const addedIds = new Set<string>();

    buildSkillGroupUnifiedItems(state.skillItems, state.globalSkillGroups, "global").forEach(
      (group) => {
        if (!addedIds.has(`skillGroup-${group.id}`)) {
          addedIds.add(`skillGroup-${group.id}`);
          items.push(group);
        }
      }
    );

    buildSkillGroupUnifiedItems(
      state.projectSkillItems,
      state.activeProjectId ? state.projectSkillGroups[state.activeProjectId] || [] : [],
      "project"
    ).forEach((group) => {
      if (!addedIds.has(`skillGroup-${group.id}`)) {
        addedIds.add(`skillGroup-${group.id}`);
        items.push(group);
      }
    });

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

    // Merge global + project agents (dedupe)
    const allAgents = Array.from(new Set([...state.agents, ...state.projectAgents]));
    allAgents.forEach((agent) => {
      if (!addedIds.has(`agent-${agent}`)) {
        addedIds.add(`agent-${agent}`);
        items.push({
          id: agent,
          label: agent,
          type: "agent",
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
