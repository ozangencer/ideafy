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
