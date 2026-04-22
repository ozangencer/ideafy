import { Project } from "../../types";
import { parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

const sortProjects = (projects: Project[]) =>
  projects.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return b.isPinned ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

export const createProjectsSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "projects"
    | "activeProjectId"
    | "isProjectsLoading"
    | "fetchProjects"
    | "addProject"
    | "updateProject"
    | "deleteProject"
    | "setActiveProject"
    | "toggleProjectPin"
  >
> = (set, get) => ({
  projects: [],
  activeProjectId: null,
  isProjectsLoading: false,

  fetchProjects: async () => {
    set({ isProjectsLoading: true });
    try {
      const response = await fetch("/api/projects");
      const projects = await parseJson<Project[]>(response);
      set({ projects, isProjectsLoading: false });
    } catch (error) {
      console.error("Failed to fetch projects:", error);
      set({ isProjectsLoading: false });
    }
  },

  addProject: async (projectData) => {
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectData),
      });
      const newProject = await parseJson<Project>(response);
      set((state) => ({
        projects: sortProjects([...state.projects, newProject]),
      }));
    } catch (error) {
      console.error("Failed to add project:", error);
    }
  },

  updateProject: async (id, updates) => {
    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const updatedProject = await parseJson<Project>(response);
      set((state) => ({
        projects: sortProjects(
          state.projects.map((p) => (p.id === id ? updatedProject : p))
        ),
      }));
    } catch (error) {
      console.error("Failed to update project:", error);
    }
  },

  deleteProject: async (id, deleteCards) => {
    try {
      const url = deleteCards
        ? `/api/projects/${id}?deleteCards=true`
        : `/api/projects/${id}`;
      await fetch(url, { method: "DELETE" });
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        cards: deleteCards
          ? state.cards.filter((c) => c.projectId !== id)
          : state.cards,
        activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
        documents: state.activeProjectId === id ? [] : state.documents,
        projectSkillItems: state.activeProjectId === id ? [] : state.projectSkillItems,
        projectAgents: state.activeProjectId === id ? [] : state.projectAgents,
        projectAgentItems: state.activeProjectId === id ? [] : state.projectAgentItems,
        selectedAgent: state.activeProjectId === id ? null : state.selectedAgent,
        isAgentViewerOpen: state.activeProjectId === id ? false : state.isAgentViewerOpen,
        projectSkillGroups: Object.fromEntries(
          Object.entries(state.projectSkillGroups).filter(([projectId]) => projectId !== id)
        ),
      }));
    } catch (error) {
      console.error("Failed to delete project:", error);
    }
  },

  setActiveProject: (projectId) => {
    set({
      activeProjectId: projectId,
      documents: [],
      memoryFiles: [],
      selectedDocument: null,
      documentContent: "",
      isDocumentEditorOpen: false,
      projectSkillItems: [],
      projectAgentItems: [],
      selectedSkill: null,
      isSkillViewerOpen: false,
      selectedAgent: null,
      isAgentViewerOpen: false,
    });
    if (projectId) {
      get().fetchDocuments(projectId);
      get().fetchMemory(projectId);
    }
  },

  toggleProjectPin: async (id) => {
    const project = get().projects.find((p) => p.id === id);
    if (project) {
      await get().updateProject(id, { isPinned: !project.isPinned });
    }
  },
});
