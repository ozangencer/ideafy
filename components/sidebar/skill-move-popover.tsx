"use client";

import { FolderPlus, MoveRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { UserSkillGroup } from "@/lib/types";

type SkillMovePopoverProps = {
  groups: UserSkillGroup[];
  currentGroupId: string | null;
  onMoveToGroup: (groupId: string | null) => void;
  onCreateGroup: () => void;
};

export function SkillMovePopover({
  groups,
  currentGroupId,
  onMoveToGroup,
  onCreateGroup,
}: SkillMovePopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          title="Move to group"
        >
          <MoveRight className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="px-2 py-1">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
            Move To Group
          </div>
        </div>

        <div className="mt-1 space-y-1">
          {groups.map((group) => {
            const isActive = currentGroupId === group.id;
            return (
              <button
                key={group.id}
                onClick={() => onMoveToGroup(group.id)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <span className="truncate">{group.name}</span>
                {isActive && <span className="text-xs text-muted-foreground">Current</span>}
              </button>
            );
          })}

          <button
            onClick={() => onMoveToGroup(null)}
            className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
              currentGroupId === null
                ? "bg-accent text-accent-foreground"
                : "text-popover-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            <span>Ungrouped</span>
            {currentGroupId === null && (
              <span className="text-xs text-muted-foreground">Current</span>
            )}
          </button>
        </div>

        <div className="mt-2 border-t border-border pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={onCreateGroup}
          >
            <FolderPlus className="h-3.5 w-3.5" />
            New Group
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
