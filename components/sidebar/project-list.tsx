"use client";

import { useState } from "react";
import { useKanbanStore } from "@/lib/store";
import { ProjectItem } from "./project-item";
import { AddProjectModal } from "./add-project-modal";
import { EditProjectModal } from "./edit-project-modal";
import { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ChevronDown, Layers, Plus } from "lucide-react";

export function ProjectList() {
  const {
    projects,
    activeProjectId,
    setActiveProject,
    isProjectListExpanded,
    toggleProjectListExpanded,
  } = useKanbanStore();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const pinnedProjects = projects.filter((p) => p.isPinned);
  const unpinnedProjects = projects.filter((p) => !p.isPinned);
  const activeUnpinnedProject =
    activeProjectId === null
      ? null
      : unpinnedProjects.find((project) => project.id === activeProjectId) ?? null;

  return (
    <div className="px-2 relative z-20">
      <button
        type="button"
        aria-expanded={isProjectListExpanded}
        aria-controls="projects-collapsible-content"
        onClick={toggleProjectListExpanded}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted"
      >
        <span className="flex items-center gap-2">
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
              isProjectListExpanded ? "rotate-0" : "-rotate-90"
            }`}
          />
          <span>Projects</span>
        </span>
        <span className="text-xs font-normal text-muted-foreground">
          {projects.length}
        </span>
      </button>

      {/* Pinned Projects */}
      {pinnedProjects.length > 0 && (
        <div className="mt-3">
          <span className="text-xs text-muted-foreground px-3 uppercase tracking-wider font-medium">
            Pinned
          </span>
          <div className="mt-1 space-y-0.5">
            {pinnedProjects.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                isActive={project.id === activeProjectId}
                onEdit={setEditingProject}
              />
            ))}
          </div>
        </div>
      )}

      {!isProjectListExpanded && activeUnpinnedProject && (
        <button
          type="button"
          onClick={() => setActiveProject(activeUnpinnedProject.id)}
          className="mt-3 flex w-full items-center gap-2 rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-left text-sm text-foreground transition-colors duration-150 hover:bg-muted"
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: activeUnpinnedProject.color }}
          />
          <span className="min-w-0 flex-1 truncate font-medium">
            {activeUnpinnedProject.name}
          </span>
          <span className="shrink-0 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            {activeUnpinnedProject.idPrefix}
          </span>
        </button>
      )}

      <div
        id="projects-collapsible-content"
        className={`overflow-hidden transition-[max-height,opacity,margin] duration-200 ease-out ${
          isProjectListExpanded ? "mt-3 max-h-[40rem] opacity-100" : "mt-0 max-h-0 opacity-0"
        }`}
      >
        {/* All Projects option */}
        <button
          onClick={() => setActiveProject(null)}
          className={`w-full text-left pl-4 pr-3 py-2 rounded-md text-sm transition-[background-color,box-shadow,color] duration-150 flex items-center gap-2 relative overflow-hidden ${
            activeProjectId === null
              ? "bg-muted text-foreground font-medium shadow-[inset_0_0_0_1px_hsl(var(--border))]"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm bg-ink transition-opacity duration-150 ${
              activeProjectId === null ? "opacity-100" : "opacity-0"
            }`}
          />
          <Layers className="h-4 w-4" />
          <span>All Projects</span>
        </button>

        {/* Other Projects */}
        {unpinnedProjects.length > 0 && (
          <div className="mt-3">
            <span className="text-xs text-muted-foreground px-3 uppercase tracking-wider font-medium">
              All Projects
            </span>
            <div className="mt-1 space-y-0.5">
              {unpinnedProjects.map((project) => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  isActive={project.id === activeProjectId}
                  onEdit={setEditingProject}
                />
              ))}
            </div>
          </div>
        )}

        {/* Add Project Button */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-3 text-muted-foreground justify-start h-9"
          onClick={() => setIsAddModalOpen(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Project
        </Button>
      </div>

      {isAddModalOpen && (
        <AddProjectModal onClose={() => setIsAddModalOpen(false)} />
      )}

      {editingProject && (
        <EditProjectModal
          project={editingProject}
          onClose={() => setEditingProject(null)}
        />
      )}
    </div>
  );
}
