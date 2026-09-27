import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectMode } from "@/lib/types";
import { projectsInWorkspace } from "@/lib/workspace";
import { Project } from "../types";

const STORAGE_KEY = "quickEntryLastProjectId";

/**
 * Fetches the project list, restores the last-used selection from localStorage,
 * and exposes a `refreshAndRestore` for the reset flow (refetches so colour/name
 * edits show up when the quick-entry window is re-opened).
 *
 * Only the main window's active workspace is offered. That choice is read from
 * the settings table on every fetch: this is a separate Electron window, so
 * the main window's store and localStorage are out of reach.
 */
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspace, setWorkspace] = useState<ProjectMode>("development");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const projectsRef = useRef<Project[]>([]);

  const fetchProjects = useCallback(async (): Promise<Project[] | null> => {
    try {
      const [projectsRes, settingsRes] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/settings"),
      ]);
      const all: Project[] = await projectsRes.json();
      // An unreadable settings row falls back to Development, the workspace
      // every project was in before there were two.
      const settings = settingsRes.ok ? await settingsRes.json() : null;
      const active: ProjectMode = settings?.activeWorkspace === "work" ? "work" : "development";
      const data = projectsInWorkspace(all, active);
      setWorkspace(active);
      setProjects(data);
      projectsRef.current = data;
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    fetchProjects().then((data) => {
      if (!data) return;
      const lastId = localStorage.getItem(STORAGE_KEY);
      if (lastId) {
        const match = data.find((p) => p.id === lastId);
        if (match) setSelectedProject(match);
      }
    });
  }, [fetchProjects]);

  const refreshAndRestore = useCallback(async () => {
    const data = await fetchProjects();
    const lastId = localStorage.getItem(STORAGE_KEY);
    const source = data ?? projectsRef.current;
    const match = lastId ? source.find((p) => p.id === lastId) : null;
    setSelectedProject(match ?? null);
  }, [fetchProjects]);

  const rememberSelection = useCallback((project: Project) => {
    localStorage.setItem(STORAGE_KEY, project.id);
  }, []);

  return {
    projects,
    workspace,
    selectedProject,
    setSelectedProject,
    refreshAndRestore,
    rememberSelection,
  };
}
