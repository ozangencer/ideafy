"use client";

import { FolderInput, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ProjectSection } from "@/lib/types";

type ProjectSectionPopoverProps = {
  sections: ProjectSection[];
  currentSectionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoveToSection: (sectionId: string | null) => void;
  onCreateSection: () => void;
};

export function ProjectSectionPopover({
  sections,
  currentSectionId,
  open,
  onOpenChange,
  onMoveToSection,
  onCreateSection,
}: ProjectSectionPopoverProps) {
  const choose = (sectionId: string | null) => {
    onOpenChange(false);
    if (sectionId !== currentSectionId) onMoveToSection(sectionId);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          title="Move to section"
          // The row itself activates the project on click.
          onClick={(event) => event.stopPropagation()}
        >
          <FolderInput className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      {/* Content is portaled, but React still bubbles its clicks to the row. */}
      <PopoverContent
        align="start"
        side="right"
        className="w-56 p-2"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="px-2 py-1">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
            Move To Section
          </div>
        </div>

        <div className="mt-1 space-y-1">
          {sections.map((section) => {
            const isActive = currentSectionId === section.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => choose(section.id)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <span className="truncate">{section.name}</span>
                {isActive && <span className="text-xs text-current opacity-70">Current</span>}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => choose(null)}
            className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
              currentSectionId === null
                ? "bg-accent text-accent-foreground"
                : "text-popover-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            <span>No section</span>
            {currentSectionId === null && (
              <span className="text-xs text-current opacity-70">Current</span>
            )}
          </button>
        </div>

        <div className="mt-2 border-t border-border pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              onOpenChange(false);
              onCreateSection();
            }}
          >
            <FolderPlus className="h-3.5 w-3.5" />
            New section…
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
