"use client";

import { useKanbanStore } from "@/lib/store";
import { PROJECT_MODE_OPTIONS } from "@/lib/types";

/**
 * Development | Work, at the top of the sidebar.
 *
 * Not a filter on the board but a choice of which board: the sidebar, All
 * Projects, Focus and quick entry all follow it. Same segmented look as the
 * Focus | All toggle in the header, so the two read as the same kind of switch.
 */
export function WorkspaceSwitch() {
  const activeWorkspace = useKanbanStore((s) => s.activeWorkspace);
  const setActiveWorkspace = useKanbanStore((s) => s.setActiveWorkspace);

  return (
    <div className="px-4 pt-3" role="radiogroup" aria-label="Workspace">
      <div className="grid grid-cols-2 rounded-md border border-border overflow-hidden bg-card">
        {PROJECT_MODE_OPTIONS.map((option) => {
          const isActive = activeWorkspace === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              title={option.description}
              onClick={() => void setActiveWorkspace(option.value)}
              className={`px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                isActive
                  ? "bg-ink text-background font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
