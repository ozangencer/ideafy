import { parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";
import { buildUnifiedItems } from "@/lib/mentions/unified-items";
import {
  AgentListItem,
  AgentPreview,
  SkillListItem,
  SkillPreview,
  UnifiedItem,
} from "@/lib/types";

export const createSkillsSlice: StoreSlice<
  Pick<KanbanStore, "skills" | "skillItems" | "projectSkillItems" | "agentItems" | "projectAgentItems" | "selectedSkill" | "isSkillViewerOpen" | "selectedAgent" | "isAgentViewerOpen" | "mcps" | "agents" | "plugins" | "projectSkills" | "projectMcps" | "projectAgents" | "fetchSkills" | "openSkillPreview" | "closeSkillViewer" | "openAgentPreview" | "closeAgentViewer" | "fetchMcps" | "fetchAgents" | "fetchPlugins" | "fetchProjectExtensions" | "getUnifiedItems">
> = (set, get) => ({
  skills: [],
  skillItems: [],
  projectSkillItems: [],
  agentItems: [],
  projectAgentItems: [],
  selectedSkill: null,
  isSkillViewerOpen: false,
  selectedAgent: null,
  isAgentViewerOpen: false,
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
    } catch (error) {
      console.error("Failed to fetch skills:", error);
      set({ skills: [], skillItems: [] });
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

  openAgentPreview: async (agent) => {
    try {
      const response = await fetch(
        `/api/agents/content?path=${encodeURIComponent(agent.path)}`
      );
      const data = await parseJson<AgentPreview>(response);
      if (!response.ok || typeof data.bodyContent !== "string") return;

      set({
        selectedAgent: {
          ...agent,
          rawContent: data.rawContent || "",
          bodyContent: data.bodyContent || "",
          frontmatter: data.frontmatter || {},
          firstHeading: data.firstHeading ?? null,
          title: data.title || agent.title,
          description: data.description ?? agent.description,
          source: data.source || agent.source,
          format: data.format || agent.format,
        },
        isAgentViewerOpen: true,
      });
    } catch (error) {
      console.error("Failed to open agent:", error);
    }
  },

  closeAgentViewer: () => {
    set({
      selectedAgent: null,
      isAgentViewerOpen: false,
    });
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
      const data = await parseJson<{ agents?: string[]; items?: AgentListItem[] }>(response);
      set({
        agents: data.agents || [],
        agentItems: data.items || [],
      });
    } catch (error) {
      console.error("Failed to fetch agents:", error);
      set({
        agents: [],
        agentItems: [],
      });
    }
  },

  fetchPlugins: async () => {
    // Plugins are future feature - return empty for now
    set({ plugins: [] });
  },

  fetchProjectExtensions: async (projectId: string | null) => {
    void get().fetchToolkit(projectId);

    if (!projectId) {
      set({
        projectSkills: [],
        projectSkillItems: [],
        projectMcps: [],
        projectAgents: [],
        projectAgentItems: [],
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
        parseJson<{ agents?: string[]; items?: AgentListItem[] }>(agentsRes),
      ]);

      set({
        projectSkills: skillsData.skills || [],
        projectSkillItems: skillsData.items || [],
        projectMcps: mcpsData.mcps || [],
        projectAgents: agentsData.agents || [],
        projectAgentItems: agentsData.items || [],
      });
    } catch (error) {
      console.error("Failed to fetch project extensions:", error);
      set({
        projectSkills: [],
        projectSkillItems: [],
        projectMcps: [],
        projectAgents: [],
        projectAgentItems: [],
      });
    }
  },

  getUnifiedItems: (): UnifiedItem[] => {
    const state = get();
    return buildUnifiedItems({
      skills: [...state.skills, ...state.projectSkills],
      mcps: [...state.mcps, ...state.projectMcps],
      agents: [...state.agents, ...state.projectAgents],
      skillItems: [...state.skillItems, ...state.projectSkillItems],
      agentItems: [...state.agentItems, ...state.projectAgentItems],
      toolkit: state.activeProjectId ? state.toolkitItems : [],
    });
  },
});
