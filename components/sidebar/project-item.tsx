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
import { hexToRgba } from "@/lib/utils";

interface ProjectItemProps {
  project: Project;
  isActive: boolean;
  onEdit: (project: Project) => void;
}

export function ProjectItem({ project, isActive, onEdit }: ProjectItemProps) {
  const { setActiveProject, toggleProjectPin } = useKanbanStore();

  const activeStyle = isActive
    ? {
        backgroundColor: hexToRgba(project.color, 0.12),
        boxShadow: `inset 0 0 0 1px ${hexToRgba(project.color, 0.28)}`,
      }
    : undefined;

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
      style={activeStyle}
      className={`w-full text-left pl-4 pr-3 py-2 rounded-md text-sm transition-[background-color,box-shadow,color] duration-150 flex items-center gap-2 group/project cursor-pointer relative overflow-hidden ${
        isActive
          ? "text-foreground font-medium"
          : "text-foreground hover:bg-muted"
      }`}
    >
      {/* Left accent bar — colored when active */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm transition-opacity duration-150 ${
          isActive ? "opacity-100" : "opacity-0"
        }`}
        style={{ backgroundColor: project.color }}
      />

      {/* Color indicator */}
      <div
        className={`rounded-full shrink-0 transition-all duration-150 ${
          isActive ? "w-2.5 h-2.5" : "w-2 h-2"
        }`}
        style={{
          backgroundColor: project.color,
          boxShadow: isActive
            ? `0 0 0 3px ${hexToRgba(project.color, 0.22)}`
            : undefined,
        }}
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
              className="h-6 w-6 text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(project);
              }}
            >
              <Pencil className="h-3 w-3" />
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
              className="h-6 w-6 text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation();
                toggleProjectPin(project.id);
              }}
            >
              <Star
                className={`h-3 w-3 ${
                  project.isPinned ? "fill-current" : ""
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
