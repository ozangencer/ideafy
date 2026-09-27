"use client";

import { BriefcaseBusiness, CodeXml, type LucideIcon } from "lucide-react";
import { useKanbanStore } from "@/lib/store";
import { PROJECT_MODE_OPTIONS, type ProjectMode } from "@/lib/types";

const MODE_ICONS: Record<ProjectMode, LucideIcon> = {
  development: CodeXml,
  work: BriefcaseBusiness,
};

/**
 * Development | Work, at the top of the sidebar.
 *
 * Not a filter on the board but a choice of which board: the sidebar, All
 * Projects, Focus and quick entry all follow it. The active side is tinted
 * with ink rather than bg-muted, which is invisible over the light theme's
 * surface.
 */
export function WorkspaceSwitch() {
  const activeWorkspace = useKanbanStore((s) => s.activeWorkspace);
  const setActiveWorkspace = useKanbanStore((s) => s.setActiveWorkspace);

  return (
    <div className="px-3 pt-3" role="radiogroup" aria-label="Workspace">
      <div className="grid grid-cols-2 gap-0.5 rounded-md border border-border bg-ink/[0.03] p-0.5">
        {PROJECT_MODE_OPTIONS.map((option) => {
          const isActive = activeWorkspace === option.value;
          const Icon = MODE_ICONS[option.value];
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              title={option.description}
              onClick={() => void setActiveWorkspace(option.value)}
              className={`flex min-w-0 items-center justify-center gap-1 rounded px-1.5 py-1.5 text-xs transition-colors ${
                isActive
                  ? "bg-ink/10 font-semibold text-foreground"
                  : "font-medium text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
