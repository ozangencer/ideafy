"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useKanbanStore } from "@/lib/store";
import { OPEN_ADD_PROJECT_EVENT } from "@/lib/workspace";
import type { Project, ProjectMode } from "@/lib/types";

const COPY: Record<ProjectMode, { title: string; body: string; label: string }> = {
  work: {
    title: "This workspace is for work that is not code",
    body:
      "Meeting minutes, proposals, mail, research, planning. Cards here skip branches and tests; " +
      "the output is saved in the project folder and the card waits in In Review for you.",
    label: "Work",
  },
  development: {
    title: "This workspace is for code",
    body:
      "Projects in a git repo. Cards here get a branch, a worktree, a dev server and a Human Test " +
      "before they are done.",
    label: "Development",
  },
};

// Home-relative, the way the sidebar and the design show paths. The client
// has no homedir, but on macOS it is always /Users/<name>.
function shortPath(folderPath: string): string {
  return folderPath.replace(/^\/Users\/[^/]+/, "~");
}

// A folder without a repo belongs in Work; one with a repo in Development.
function isSuggestedFor(project: Project, workspace: ProjectMode): boolean {
  return workspace === "work" ? !project.isGitRepo : project.isGitRepo;
}

/**
 * The board of a workspace with no projects yet: what the workspace is for,
 * a way to start one, and every project from the other workspace with a
 * one-click move. Moving only rewrites the project's mode, so cards and
 * statuses stay where they are.
 */
export function WorkspaceEmptyState({ otherProjects }: { otherProjects: Project[] }) {
  const workspace = useKanbanStore((s) => s.activeWorkspace);
  const updateProject = useKanbanStore((s) => s.updateProject);
  const copy = COPY[workspace];

  const sorted = [...otherProjects].sort(
    (a, b) =>
      Number(isSuggestedFor(b, workspace)) - Number(isSuggestedFor(a, workspace)) ||
      a.name.localeCompare(b.name)
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-xl px-6 py-24">
        <h2 className="text-xl font-semibold text-foreground">{copy.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy.body}</p>

        <Button
          className="mt-5"
          onClick={() => window.dispatchEvent(new CustomEvent(OPEN_ADD_PROJECT_EVENT))}
        >
          <Plus className="mr-2 h-4 w-4" />
          New {copy.label} project
        </Button>

        {sorted.length > 0 && (
          <>
            <p className="mt-8 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Or move an existing project
            </p>
            <ul className="mt-2 divide-y divide-border rounded-md border border-border">
              {sorted.map((project) => (
                <li key={project.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: project.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{project.name}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {shortPath(project.folderPath)} · {project.isGitRepo ? "git repo" : "not a git repo"}
                    </p>
                  </div>
                  {isSuggestedFor(project, workspace) && (
                    <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
                      Suggested
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void updateProject(project.id, { mode: workspace })}
                  >
                    Move to {copy.label}
                  </Button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Moving only changes where the project is listed and how its columns read. Cards and
              statuses stay as they are.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
