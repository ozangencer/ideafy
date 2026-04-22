import {
  createWorktree,
  generateBranchName,
  getWorktreePath,
  isGitRepo,
  worktreeExists,
} from "@/lib/git";
import type { Phase } from "@/lib/prompts";

interface SetupWorktreeArgs {
  workingDir: string;
  phase: Phase;
  project: { idPrefix: string; useWorktrees?: boolean | null } | null;
  card: {
    taskNumber?: number | null;
    title: string;
    useWorktree?: boolean | null;
    gitBranchName?: string | null;
    gitWorktreePath?: string | null;
    gitBranchStatus?: string | null;
    gitWorktreeStatus?: string | null;
  };
}

export interface WorktreeSetupResult {
  actualWorkingDir: string;
  gitBranchName: string | null;
  gitBranchStatus: string | null;
  gitWorktreePath: string | null;
  gitWorktreeStatus: string | null;
  error?: string;
}

/**
 * Resolve the working directory for an autonomous Claude run, creating or
 * reusing a git worktree as needed. Behaviour mirrors the original logic:
 *
 * - `implementation` + worktrees enabled → create (or reuse) a feature-branch
 *   worktree under `.worktrees/kanban/`.
 * - `implementation`/`retest` + existing worktree path on the card → reuse it.
 * - Worktrees disabled or non-implementation phase → fall back to `workingDir`.
 *
 * Returns the working directory + updated git metadata for the card row.
 * If worktree creation fails, `error` is populated and `actualWorkingDir`
 * falls back to `workingDir` (caller decides whether to abort).
 */
export async function setupWorktree(args: SetupWorktreeArgs): Promise<WorktreeSetupResult> {
  const { workingDir, phase, project, card } = args;

  // Per-card override wins; otherwise fall back to project setting (default: true).
  const shouldUseWorktree = card.useWorktree ?? project?.useWorktrees ?? true;

  const base: WorktreeSetupResult = {
    actualWorkingDir: workingDir,
    gitBranchName: card.gitBranchName ?? null,
    gitBranchStatus: card.gitBranchStatus ?? null,
    gitWorktreePath: card.gitWorktreePath ?? null,
    gitWorktreeStatus: card.gitWorktreeStatus ?? null,
  };

  if (phase === "implementation" && project && card.taskNumber && shouldUseWorktree) {
    if (!(await isGitRepo(workingDir))) return base;

    const branchName =
      card.gitBranchName || generateBranchName(project.idPrefix, card.taskNumber, card.title);

    const expectedWorktreePath = getWorktreePath(workingDir, branchName);
    if (await worktreeExists(workingDir, expectedWorktreePath)) {
      console.log(`[Git Worktree] Using existing worktree: ${expectedWorktreePath}`);
      return {
        actualWorkingDir: expectedWorktreePath,
        gitBranchName: branchName,
        gitBranchStatus: "active",
        gitWorktreePath: expectedWorktreePath,
        gitWorktreeStatus: "active",
      };
    }

    console.log(`[Git Worktree] Creating worktree for branch: ${branchName}`);
    const result = await createWorktree(workingDir, branchName);
    if (!result.success) {
      console.error(`[Git Worktree] Failed to create worktree: ${result.error}`);
      return { ...base, error: result.error };
    }

    console.log(`[Git Worktree] Created worktree at: ${result.worktreePath}`);
    return {
      actualWorkingDir: result.worktreePath,
      gitBranchName: branchName,
      gitBranchStatus: "active",
      gitWorktreePath: result.worktreePath,
      gitWorktreeStatus: "active",
    };
  }

  if ((phase === "implementation" || phase === "retest") && card.gitWorktreePath && shouldUseWorktree) {
    if (await worktreeExists(workingDir, card.gitWorktreePath)) {
      console.log(`[Git Worktree] Using existing worktree: ${card.gitWorktreePath}`);
      return { ...base, actualWorkingDir: card.gitWorktreePath };
    }
    return base;
  }

  if (!shouldUseWorktree && (phase === "implementation" || phase === "retest")) {
    console.log(`[Git] Working directly on main branch (worktrees disabled)`);
  }

  return base;
}
