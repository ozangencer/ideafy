/**
 * Which workspace a card belongs to, read from its project's mode.
 *
 * Client-safe on purpose: the board, the sidebar and quick entry all ask the
 * same question, and a card with no project — or a project this machine does
 * not have, as with pool cards — must land in the same place on every one of
 * them. That place is Development, since that is where every card lived
 * before modes existed.
 */

import { Card, DEFAULT_PROJECT_MODE, Project, ProjectMode } from "./types";

/** Fired by the board's empty-workspace view to open the sidebar's Add Project modal. */
export const OPEN_ADD_PROJECT_EVENT = "ideafy:open-add-project";

export function projectModeOf(
  projectId: string | null | undefined,
  projects: Pick<Project, "id" | "mode">[]
): ProjectMode {
  if (!projectId) return DEFAULT_PROJECT_MODE;
  return projects.find((project) => project.id === projectId)?.mode ?? DEFAULT_PROJECT_MODE;
}

export function projectsInWorkspace<T extends { mode?: ProjectMode | null }>(
  projects: T[],
  workspace: ProjectMode
): T[] {
  return projects.filter((project) => (project.mode ?? DEFAULT_PROJECT_MODE) === workspace);
}

export function isCardInWorkspace(
  card: Pick<Card, "projectId">,
  projects: Pick<Project, "id" | "mode">[],
  workspace: ProjectMode
): boolean {
  return projectModeOf(card.projectId, projects) === workspace;
}

/**
 * Whether a card's work should happen on its own branch in a worktree.
 *
 * A Work project never gets one, whatever the project or card toggle says: it
 * has no build to protect and often no repo at all, and a branch nobody can
 * merge from the card would be the only trace the mode left. The per-card
 * override still wins inside a Development project, as it always has.
 */
export function shouldUseWorktree(
  card: { useWorktree?: boolean | null },
  project: { useWorktrees?: boolean | null; mode?: string | null } | null | undefined
): boolean {
  if (project?.mode === "work") return false;
  return card.useWorktree ?? project?.useWorktrees ?? true;
}

/**
 * What to store in a card's `useWorktree` once you pick isolated branch or
 * current branch for it. A choice that matches the project default stores
 * null, so the card keeps following the project instead of collecting an
 * override that only restates it. Start, Quick Fix and Add to queue all write
 * through here, so the three never disagree on the rule.
 */
export function worktreeOverrideFor(choice: boolean, projectDefault: boolean): boolean | null {
  return choice === projectDefault ? null : choice;
}
