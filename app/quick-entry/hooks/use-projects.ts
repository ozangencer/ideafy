import { useCallback, useEffect, useRef, useState } from "react";
import { Project } from "../types";

const STORAGE_KEY = "quickEntryLastProjectId";

/**
 * Fetches the project list, restores the last-used selection from localStorage,
 * and exposes a `refreshAndRestore` for the reset flow (refetches so colour/name
 * edits show up when the quick-entry window is re-opened).
 */
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const projectsRef = useRef<Project[]>([]);

  const fetchProjects = useCallback(async (): Promise<Project[] | null> => {
    try {
      const res = await fetch("/api/projects");
      const data: Project[] = await res.json();
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
    selectedProject,
    setSelectedProject,
    refreshAndRestore,
    rememberSelection,
  };
}
