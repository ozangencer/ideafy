"use client";

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useKanbanStore } from "@/lib/store";
import { Project, ProjectSection } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowUp, Pencil, Star } from "lucide-react";
import { hexToRgba } from "@/lib/utils";
import { ProjectSectionPopover } from "./project-section-popover";

interface ProjectItemProps {
  project: Project;
  isActive: boolean;
  onEdit: (project: Project) => void;
  /** Commits on the local default branch that origin has not seen. */
  unpushedCount?: number;
  onShowUnpushed?: (project: Project) => void;
  sections?: ProjectSection[];
  /** The project's section, or null when it has none (or it points nowhere). */
  currentSectionId?: string | null;
  onMoveToSection?: (project: Project, sectionId: string | null) => void;
  onCreateSection?: (project: Project) => void;
}

export function ProjectItem({
  project,
  isActive,
  onEdit,
  unpushedCount = 0,
  onShowUnpushed,
  sections = [],
  currentSectionId = null,
  onMoveToSection,
  onCreateSection,
}: ProjectItemProps) {
  const { setActiveProject, toggleProjectPin } = useKanbanStore(
    useShallow((s) => ({ setActiveProject: s.setActiveProject, toggleProjectPin: s.toggleProjectPin }))
  );
  const [isSectionPopoverOpen, setIsSectionPopoverOpen] = useState(false);

  const showUnpushed = unpushedCount > 0 && Boolean(onShowUnpushed);
  // Hover reveals them too; this covers the states that must hold without it.
  const showButtons = isActive || isSectionPopoverOpen;

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
      <span className="truncate flex-1 min-w-0">{project.name}</span>

      {/* Prefix badge - swapped out for the buttons on hover/active, and
          whenever the unpushed badge is showing: a warning outranks a
          reminder of a prefix that every card ID already carries. */}
      <span className={`text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded shrink-0 ${
        showButtons || showUnpushed ? "hidden" : "group-hover/project:hidden"
      }`}>
        {project.idPrefix}
      </span>

      {/* Action buttons - kept in the flex flow so the name truncates in front
          of them instead of running underneath. The negative margin stops the
          24px buttons from growing the row on hover. The unpushed badge sits
          last so it stays pinned to the right edge. */}
      <div className="-my-1 -mr-1 flex items-center gap-0.5 shrink-0">
        <div className={`items-center gap-0.5 ${
          showButtons ? "flex" : "hidden group-hover/project:flex"
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

        {/* Move to section */}
        {onMoveToSection && (
          <ProjectSectionPopover
            sections={sections}
            currentSectionId={currentSectionId}
            open={isSectionPopoverOpen}
            onOpenChange={setIsSectionPopoverOpen}
            onMoveToSection={(sectionId) => onMoveToSection(project, sectionId)}
            onCreateSection={() => onCreateSection?.(project)}
          />
        )}

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

        {/* Unpushed indicator — always visible, because its whole job is to be
            noticed without being looked for. */}
        {showUnpushed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onShowUnpushed?.(project);
                }}
                className="flex items-center gap-0.5 h-5 pl-1 pr-1.5 rounded text-[10px] font-medium tabular-nums bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 transition-colors dark:text-amber-500"
              >
                <ArrowUp className="h-3 w-3" />
                {unpushedCount}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>
                {unpushedCount} commit{unpushedCount === 1 ? "" : "s"} not pushed yet
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
