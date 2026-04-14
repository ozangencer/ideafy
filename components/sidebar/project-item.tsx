"use client";

import { useKanbanStore } from "@/lib/store";
import { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Pencil, Star } from "lucide-react";

interface ProjectItemProps {
  project: Project;
  isActive: boolean;
  onEdit: (project: Project) => void;
}

export function ProjectItem({ project, isActive, onEdit }: ProjectItemProps) {
  const { setActiveProject, toggleProjectPin } = useKanbanStore();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setActiveProject(project.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setActiveProject(project.id);
        }
      }}
      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2 group/project cursor-pointer relative ${
        isActive
          ? "bg-[#fafaf9] text-[#0a0a0a] font-medium border-l-2 border-[#0a0a0a]"
          : "text-foreground hover:bg-muted"
      }`}
    >
      {/* Color indicator */}
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: project.color }}
      />

      {/* Project name */}
      <span className="truncate flex-1">{project.name}</span>

      {/* Prefix badge - hide on hover/active to make room for buttons */}
      <span className={`text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded shrink-0 transition-opacity ${
        isActive ? "opacity-0" : "group-hover/project:opacity-0"
      }`}>
        {project.idPrefix}
      </span>

      {/* Action buttons - absolute positioned to avoid overflow */}
      <div className={`absolute right-2 flex items-center gap-0.5 transition-opacity ${
        isActive ? "opacity-100" : "opacity-0 group-hover/project:opacity-100"
      }`}>
        {/* Edit button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(project);
              }}
            >
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Edit project</p>
          </TooltipContent>
        </Tooltip>

        {/* Pin button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                toggleProjectPin(project.id);
              }}
            >
              <Star
                className={`h-3 w-3 ${
                  project.isPinned
                    ? "fill-[#0a0a0a] text-[#0a0a0a]"
                    : "text-muted-foreground"
                }`}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{project.isPinned ? "Unpin project" : "Pin project"}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
