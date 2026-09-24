import { Project, ProjectSection } from "../../types";
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
    | "projectSections"
    | "createProjectSection"
    | "renameProjectSection"
    | "deleteProjectSection"
    | "moveProjectSection"
    | "toggleProjectSectionCollapsed"
    | "moveProjectToSection"
  >
> = (set, get) => ({
  projects: [],
  activeProjectId: null,
  isProjectsLoading: false,
  projectSections: [],

  fetchProjects: async () => {
    set({ isProjectsLoading: true });
    try {
      const [projectsResponse, sectionsResponse] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/project-sections"),
      ]);
      const projects = await parseJson<Project[]>(projectsResponse);
      // A failed sections fetch must not take the project list down with it:
      // every project simply renders under the flat list.
      const sections = sectionsResponse.ok
        ? await parseJson<ProjectSection[]>(sectionsResponse)
        : [];
      set({
        projects,
        projectSections: Array.isArray(sections) ? sections : [],
        isProjectsLoading: false,
      });
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

  createProjectSection: async (name) => {
    try {
      const response = await fetch("/api/project-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) return null;
      const section = await parseJson<ProjectSection>(response);
      set((state) => ({ projectSections: [...state.projectSections, section] }));
      return section;
    } catch (error) {
      console.error("Failed to create project section:", error);
      return null;
    }
  },

  renameProjectSection: async (id, name) => {
    try {
      const response = await fetch(`/api/project-sections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) return;
      set({ projectSections: await parseJson<ProjectSection[]>(response) });
    } catch (error) {
      console.error("Failed to rename project section:", error);
    }
  },

  deleteProjectSection: async (id) => {
    try {
      const response = await fetch(`/api/project-sections/${id}`, { method: "DELETE" });
      if (!response.ok) return;
      // Mirror the server: the section's projects fall back to "Other".
      set((state) => ({
        projectSections: state.projectSections.filter((section) => section.id !== id),
        projects: state.projects.map((project) =>
          project.sectionId === id ? { ...project, sectionId: null } : project
        ),
      }));
    } catch (error) {
      console.error("Failed to delete project section:", error);
    }
  },

  moveProjectSection: async (id, direction) => {
    try {
      const response = await fetch(`/api/project-sections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ move: direction }),
      });
      if (!response.ok) return;
      set({ projectSections: await parseJson<ProjectSection[]>(response) });
    } catch (error) {
      console.error("Failed to move project section:", error);
    }
  },

  // Optimistic: the chevron must answer the click, not the round trip.
  toggleProjectSectionCollapsed: async (id) => {
    const section = get().projectSections.find((s) => s.id === id);
    if (!section) return;
    const collapsed = !section.collapsed;
    const setCollapsed = (value: boolean) =>
      set((state) => ({
        projectSections: state.projectSections.map((s) =>
          s.id === id ? { ...s, collapsed: value } : s
        ),
      }));

    setCollapsed(collapsed);
    try {
      const response = await fetch(`/api/project-sections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collapsed }),
      });
      if (!response.ok) setCollapsed(!collapsed);
    } catch (error) {
      console.error("Failed to toggle project section:", error);
      setCollapsed(!collapsed);
    }
  },

  moveProjectToSection: async (projectId, sectionId) => {
    await get().updateProject(projectId, { sectionId });
  },
});
