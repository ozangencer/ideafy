"use client";

import { ArrowDown, ArrowUp, ChevronDown, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectSection } from "@/lib/types";

interface ProjectSectionHeaderProps {
  section: ProjectSection;
  /** Unpinned projects only — a pinned project is listed under Pinned. */
  projectCount: number;
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onRename: () => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
}

export function ProjectSectionHeader({
  section,
  projectCount,
  isFirst,
  isLast,
  onToggle,
  onRename,
  onMove,
  onDelete,
}: ProjectSectionHeaderProps) {
  return (
    <div className="group/section flex items-center gap-1 pr-1">
      <button
        type="button"
        aria-expanded={!section.collapsed}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-3 py-1 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform duration-200 ${
            section.collapsed ? "-rotate-90" : "rotate-0"
          }`}
        />
        <span className="truncate">{section.name}</span>
        <span className="shrink-0 font-normal normal-case tracking-normal tabular-nums">
          {projectCount}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover/section:opacity-100 data-[state=open]:opacity-100"
            title="Section actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={onRename}>
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isFirst} onClick={() => onMove("up")}>
            <ArrowUp className="h-3.5 w-3.5" />
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isLast} onClick={() => onMove("down")}>
            <ArrowDown className="h-3.5 w-3.5" />
            Move down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
