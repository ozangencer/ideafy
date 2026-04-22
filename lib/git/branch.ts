import { git, buildCommitArgs } from "./core";
import { getCurrentBranch, getDefaultBranch, hasStagedChanges } from "./repo";

type WithStashResult<T> =
  | { success: true; value: T; stashed: boolean; stashRestoreFailed: boolean }
  | { success: false; error: string };

/**
 * Run a git operation in-place on the main repo, safely juggling uncommitted
 * changes. If the working tree is dirty, stashes changes first and tries to
 * pop them afterwards. Reports whether stashing happened and whether the pop
 * failed, so callers can surface the exact user-facing message they want.
 */
async function withStash<T>(
  projectPath: string,
  stashLabel: string,
  operation: () => Promise<T>,
): Promise<WithStashResult<T>> {
  let stashed = false;

  try {
    const { stdout } = await git(projectPath, "status", "--porcelain");
    if (stdout.trim() !== "") {
      console.log(`[Git] Stashing uncommitted changes (${stashLabel})...`);
      await git(projectPath, "stash", "push", "-m", stashLabel);
      stashed = true;
    }

    const value = await operation();

    let stashRestoreFailed = false;
    if (stashed) {
      console.log(`[Git] Restoring stashed changes (${stashLabel})...`);
      try {
        await git(projectPath, "stash", "pop");
      } catch {
        console.error(`[Git] Stash pop failed (${stashLabel}), changes remain in stash`);
        stashRestoreFailed = true;
      }
    }

    return { success: true, value, stashed, stashRestoreFailed };
  } catch (error) {
    if (stashed) {
      try {
        await git(projectPath, "stash", "pop");
      } catch {
        console.error(`[Git] Could not restore stash after failure (${stashLabel})`);
      }
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Create and checkout a new branch from main/master.
 * Automatically stashes uncommitted changes and restores them after.
 */
export async function createBranch(
  projectPath: string,
  branchName: string
): Promise<{ success: boolean; error?: string; stashApplied?: boolean }> {
  const result = await withStash(projectPath, "kanban-auto-stash", async () => {
    const defaultBranch = await getDefaultBranch(projectPath);
    await git(projectPath, "checkout", defaultBranch);
    await git(projectPath, "checkout", "-b", branchName);
  });

  if (!result.success) return { success: false, error: result.error };

  if (result.stashRestoreFailed) {
    return {
      success: true,
      stashApplied: false,
      error: "Branch created but stash could not be applied. Run 'git stash pop' manually.",
    };
  }

  return { success: true, stashApplied: result.stashed };
}

/**
 * Squash merge a branch into main/master and delete the branch.
 * Automatically stashes uncommitted changes and restores them after.
 */
export async function squashMerge(
  projectPath: string,
  branchName: string,
  commitMessage: string
): Promise<{ success: boolean; error?: string }> {
  const result = await withStash(projectPath, "kanban-merge-stash", async () => {
    const defaultBranch = await getDefaultBranch(projectPath);
    const currentBranch = await getCurrentBranch(projectPath);

    if (currentBranch === branchName) {
      await git(projectPath, "checkout", defaultBranch);
    }

    await git(projectPath, "merge", "--squash", branchName);

    if (await hasStagedChanges(projectPath)) {
      await git(projectPath, ...buildCommitArgs(commitMessage));
      console.log("[Git] Squash merge committed successfully");
    } else {
      console.log("[Git] No changes to commit after squash merge (branch may have no unique commits)");
    }

    await git(projectPath, "branch", "-D", branchName);
  });

  if (!result.success) return { success: false, error: result.error };
  return { success: true };
}

/**
 * Rollback: checkout to main/master and optionally delete the feature branch.
 * Automatically stashes uncommitted changes and restores them after.
 */
export async function rollback(
  projectPath: string,
  branchName: string,
  deleteBranch: boolean
): Promise<{ success: boolean; error?: string }> {
  const result = await withStash(projectPath, "kanban-rollback-stash", async () => {
    const defaultBranch = await getDefaultBranch(projectPath);
    await git(projectPath, "checkout", defaultBranch);

    if (deleteBranch) {
      await git(projectPath, "branch", "-D", branchName);
    }
  });

  if (!result.success) return { success: false, error: result.error };
  return { success: true };
}

/**
 * Checkout to an existing branch.
 * Automatically stashes uncommitted changes and restores them after.
 */
export async function checkoutBranch(
  projectPath: string,
  branchName: string
): Promise<{ success: boolean; error?: string }> {
  const result = await withStash(projectPath, "kanban-checkout-stash", async () => {
    await git(projectPath, "checkout", branchName);
  });

  if (!result.success) return { success: false, error: result.error };
  return { success: true };
}
