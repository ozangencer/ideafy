"use client";

import { useState } from "react";
import { useKanbanStore } from "@/lib/store";
import { ProjectItem } from "./project-item";
import { AddProjectModal } from "./add-project-modal";
import { EditProjectModal } from "./edit-project-modal";
import { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Plus, Layers } from "lucide-react";

export function ProjectList() {
  const { projects, activeProjectId, setActiveProject } = useKanbanStore();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const pinnedProjects = projects.filter((p) => p.isPinned);
  const unpinnedProjects = projects.filter((p) => !p.isPinned);

  return (
    <div className="px-2 relative z-20">
      {/* All Projects option */}
      <button
        onClick={() => setActiveProject(null)}
        className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2 ${
          activeProjectId === null
            ? "bg-paper-cream text-ink font-medium border-l-2 border-ink"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <Layers className="h-4 w-4" />
        <span>All Projects</span>
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

      {/* Other Projects */}
      {unpinnedProjects.length > 0 && (
        <div className="mt-3">
          {pinnedProjects.length > 0 && (
            <span className="text-xs text-muted-foreground px-3 uppercase tracking-wider font-medium">
              Projects
            </span>
          )}
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
