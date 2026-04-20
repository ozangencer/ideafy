import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const execFileAsync = promisify(execFile);

// Every git invocation in this module goes through `git()` which uses
// execFile. That means args are passed as a real argv array — no shell,
// no string interpolation, no escaping contract the caller has to honour.
// A branch name containing $(id), "; rm -rf ~; echo ", or a newline is a
// literal argument that git will either accept or reject, never shell out.
export async function git(
  cwd: string,
  ...args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd });
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50);
}

export function generateBranchName(
  idPrefix: string,
  taskNumber: number,
  title: string
): string {
  const slug = slugify(title);
  return `kanban/${idPrefix}-${taskNumber}-${slug}`;
}

export async function isGitRepo(projectPath: string): Promise<boolean> {
  try {
    await git(projectPath, "rev-parse", "--git-dir");
    return true;
  } catch {
    return false;
  }
}

export async function getCurrentBranch(projectPath: string): Promise<string> {
  const { stdout } = await git(projectPath, "branch", "--show-current");
  return stdout.trim();
}

export async function branchExists(
  projectPath: string,
  branchName: string
): Promise<boolean> {
  try {
    await git(
      projectPath,
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branchName}`
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Create and checkout a new branch from main/master
 * Automatically stashes uncommitted changes and restores them after
 */
export async function createBranch(
  projectPath: string,
  branchName: string
): Promise<{ success: boolean; error?: string; stashApplied?: boolean }> {
  let didStash = false;

  try {
    const { stdout: statusOutput } = await git(projectPath, "status", "--porcelain");
    const hasChanges = statusOutput.trim() !== "";

    if (hasChanges) {
      console.log("[Git] Stashing uncommitted changes...");
      await git(projectPath, "stash", "push", "-m", "kanban-auto-stash");
      didStash = true;
    }

    const defaultBranch = await getDefaultBranch(projectPath);

    await git(projectPath, "checkout", defaultBranch);
    await git(projectPath, "checkout", "-b", branchName);

    if (didStash) {
      console.log("[Git] Restoring stashed changes...");
      try {
        await git(projectPath, "stash", "pop");
      } catch {
        console.error("[Git] Stash pop failed, changes remain in stash");
        return {
          success: true,
          stashApplied: false,
          error: "Branch created but stash could not be applied. Run 'git stash pop' manually.",
        };
      }
    }

    return { success: true, stashApplied: didStash };
  } catch (error) {
    if (didStash) {
      try {
        await git(projectPath, "stash", "pop");
      } catch {
        console.error("[Git] Could not restore stash after failure");
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getDefaultBranch(projectPath: string): Promise<string> {
  try {
    const { stdout } = await git(
      projectPath,
      "symbolic-ref",
      "refs/remotes/origin/HEAD"
    );
    return stdout
      .trim()
      .replace("refs/remotes/origin/", "")
      .replace("refs/heads/", "");
  } catch {
    try {
      await git(projectPath, "show-ref", "--verify", "--quiet", "refs/heads/main");
      return "main";
    } catch {
      return "master";
    }
  }
}

/**
 * Squash merge a branch into main/master and delete the branch
 * Automatically stashes uncommitted changes and restores them after
 */
export async function squashMerge(
  projectPath: string,
  branchName: string,
  commitMessage: string
): Promise<{ success: boolean; error?: string }> {
  let didStash = false;

  try {
    const { stdout: statusOutput } = await git(projectPath, "status", "--porcelain");
    const hasChanges = statusOutput.trim() !== "";

    if (hasChanges) {
      console.log("[Git] Stashing uncommitted changes before merge...");
      await git(projectPath, "stash", "push", "-m", "kanban-merge-stash");
      didStash = true;
    }

    const defaultBranch = await getDefaultBranch(projectPath);
    const currentBranch = await getCurrentBranch(projectPath);

    if (currentBranch === branchName) {
      await git(projectPath, "checkout", defaultBranch);
    }

    await git(projectPath, "merge", "--squash", branchName);

    let hasStagedChanges = false;
    try {
      await git(projectPath, "diff", "--cached", "--quiet");
      hasStagedChanges = false;
    } catch {
      hasStagedChanges = true;
    }

    if (hasStagedChanges) {
      await git(projectPath, ...buildCommitArgs(commitMessage));
      console.log("[Git] Squash merge committed successfully");
    } else {
      console.log("[Git] No changes to commit after squash merge (branch may have no unique commits)");
    }

    await git(projectPath, "branch", "-D", branchName);

    if (didStash) {
      console.log("[Git] Restoring stashed changes after merge...");
      try {
        await git(projectPath, "stash", "pop");
      } catch {
        console.error("[Git] Stash pop failed after merge, changes remain in stash");
      }
    }

    return { success: true };
  } catch (error) {
    if (didStash) {
      try {
        await git(projectPath, "stash", "pop");
      } catch {
        console.error("[Git] Could not restore stash after failure");
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Rollback: checkout to main/master and optionally delete the feature branch
 * Automatically stashes uncommitted changes and restores them after
 */
export async function rollback(
  projectPath: string,
  branchName: string,
  deleteBranch: boolean
): Promise<{ success: boolean; error?: string }> {
  let didStash = false;

  try {
    const { stdout: statusOutput } = await git(projectPath, "status", "--porcelain");
    const hasChanges = statusOutput.trim() !== "";

    if (hasChanges) {
      console.log("[Git] Stashing uncommitted changes before rollback...");
      await git(projectPath, "stash", "push", "-m", "kanban-rollback-stash");
      didStash = true;
    }

    const defaultBranch = await getDefaultBranch(projectPath);
    await git(projectPath, "checkout", defaultBranch);

    if (deleteBranch) {
      await git(projectPath, "branch", "-D", branchName);
    }

    if (didStash) {
      console.log("[Git] Restoring stashed changes after rollback...");
      try {
        await git(projectPath, "stash", "pop");
      } catch {
        console.error("[Git] Stash pop failed after rollback, changes remain in stash");
      }
    }

    return { success: true };
  } catch (error) {
    if (didStash) {
      try {
        await git(projectPath, "stash", "pop");
      } catch {
        console.error("[Git] Could not restore stash after failure");
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getBranchStatus(
  projectPath: string,
  branchName: string
): Promise<{ ahead: number; behind: number; exists: boolean }> {
  try {
    const defaultBranch = await getDefaultBranch(projectPath);

    const exists = await branchExists(projectPath, branchName);
    if (!exists) {
      return { ahead: 0, behind: 0, exists: false };
    }

    const { stdout } = await git(
      projectPath,
      "rev-list",
      "--left-right",
      "--count",
      `${defaultBranch}...${branchName}`
    );

    const [behind, ahead] = stdout.trim().split(/\s+/).map(Number);

    return { ahead: ahead || 0, behind: behind || 0, exists: true };
  } catch {
    return { ahead: 0, behind: 0, exists: false };
  }
}

/**
 * Checkout to an existing branch
 * Automatically stashes uncommitted changes and restores them after
 */
export async function checkoutBranch(
  projectPath: string,
  branchName: string
): Promise<{ success: boolean; error?: string }> {
  let didStash = false;

  try {
    const { stdout: statusOutput } = await git(projectPath, "status", "--porcelain");
    const hasChanges = statusOutput.trim() !== "";

    if (hasChanges) {
      console.log("[Git] Stashing uncommitted changes before checkout...");
      await git(projectPath, "stash", "push", "-m", "kanban-checkout-stash");
      didStash = true;
    }

    await git(projectPath, "checkout", branchName);

    if (didStash) {
      console.log("[Git] Restoring stashed changes after checkout...");
      try {
        await git(projectPath, "stash", "pop");
      } catch {
        console.error("[Git] Stash pop failed after checkout, changes remain in stash");
      }
    }

    return { success: true };
  } catch (error) {
    if (didStash) {
      try {
        await git(projectPath, "stash", "pop");
      } catch {
        console.error("[Git] Could not restore stash after failure");
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================
// Git Worktree Functions
// ============================================

export function getWorktreeBaseDir(projectPath: string): string {
  return join(projectPath, ".worktrees", "kanban");
}

export function getWorktreePath(projectPath: string, branchName: string): string {
  const branchPart = branchName.startsWith("kanban/")
    ? branchName.slice(7)
    : branchName;

  return join(getWorktreeBaseDir(projectPath), branchPart);
}

export async function worktreeExists(
  projectPath: string,
  worktreePath: string
): Promise<boolean> {
  try {
    if (!existsSync(worktreePath)) {
      return false;
    }

    const { stdout } = await git(projectPath, "worktree", "list", "--porcelain");

    return stdout.includes(`worktree ${worktreePath}`);
  } catch {
    return false;
  }
}

interface WorktreeInfo {
  path: string;
  branch: string | null;
  commit: string;
  isLocked: boolean;
  isPrunable: boolean;
}

export async function listWorktrees(projectPath: string): Promise<WorktreeInfo[]> {
  try {
    const { stdout } = await git(projectPath, "worktree", "list", "--porcelain");

    const worktrees: WorktreeInfo[] = [];
    const entries = stdout.trim().split("\n\n");

    for (const entry of entries) {
      if (!entry.trim()) continue;

      const lines = entry.split("\n");
      const info: Partial<WorktreeInfo> = {
        isLocked: false,
        isPrunable: false,
      };

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          info.path = line.slice(9);
        } else if (line.startsWith("HEAD ")) {
          info.commit = line.slice(5);
        } else if (line.startsWith("branch refs/heads/")) {
          info.branch = line.slice(18);
        } else if (line === "locked") {
          info.isLocked = true;
        } else if (line === "prunable") {
          info.isPrunable = true;
        }
      }

      if (info.path && info.commit) {
        worktrees.push(info as WorktreeInfo);
      }
    }

    return worktrees;
  } catch {
    return [];
  }
}

/**
 * Create a new worktree for a branch
 * If the branch doesn't exist, creates it from the default branch
 */
export async function createWorktree(
  projectPath: string,
  branchName: string
): Promise<{ success: boolean; worktreePath: string; error?: string }> {
  const worktreePath = getWorktreePath(projectPath, branchName);
  const baseDir = getWorktreeBaseDir(projectPath);

  try {
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
      console.log(`[Git Worktree] Created base directory: ${baseDir}`);
    }

    const exists = await worktreeExists(projectPath, worktreePath);
    if (exists) {
      console.log(`[Git Worktree] Worktree already exists: ${worktreePath}`);
      return { success: true, worktreePath };
    }

    const branchExistsResult = await branchExists(projectPath, branchName);

    if (branchExistsResult) {
      console.log(`[Git Worktree] Creating worktree for existing branch: ${branchName}`);
      await git(projectPath, "worktree", "add", worktreePath, branchName);
    } else {
      const defaultBranch = await getDefaultBranch(projectPath);
      console.log(`[Git Worktree] Creating new branch and worktree: ${branchName} from ${defaultBranch}`);
      await git(
        projectPath,
        "worktree",
        "add",
        "-b",
        branchName,
        worktreePath,
        defaultBranch
      );
    }

    console.log(`[Git Worktree] Created worktree at: ${worktreePath}`);
    return { success: true, worktreePath };
  } catch (error) {
    console.error(`[Git Worktree] Failed to create worktree:`, error);
    return {
      success: false,
      worktreePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function removeWorktree(
  projectPath: string,
  worktreePath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const exists = await worktreeExists(projectPath, worktreePath);
    if (!exists) {
      console.log(`[Git Worktree] Worktree doesn't exist, skipping removal: ${worktreePath}`);
      return { success: true };
    }

    console.log(`[Git Worktree] Removing worktree: ${worktreePath}`);
    await git(projectPath, "worktree", "remove", "--force", worktreePath);

    console.log(`[Git Worktree] Worktree removed successfully`);
    return { success: true };
  } catch (error) {
    console.error(`[Git Worktree] Failed to remove worktree:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function pruneWorktrees(
  projectPath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[Git Worktree] Pruning stale worktrees...`);
    await git(projectPath, "worktree", "prune");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Squash merge from a worktree branch into the default branch
 * Works from the main repository, not the worktree
 */
export async function squashMergeFromWorktree(
  projectPath: string,
  branchName: string,
  commitMessage: string
): Promise<{ success: boolean; error?: string; uncommittedInMain?: boolean }> {
  try {
    const { stdout: statusOutput } = await git(projectPath, "status", "--porcelain");
    const hasChanges = statusOutput.trim() !== "";

    if (hasChanges) {
      console.log("[Git Worktree] Uncommitted changes found in main repo, blocking merge");
      return {
        success: false,
        error: "There are uncommitted changes in the main repository. Please commit your changes first.",
        uncommittedInMain: true,
      };
    }

    const defaultBranch = await getDefaultBranch(projectPath);
    const currentBranch = await getCurrentBranch(projectPath);

    if (currentBranch !== defaultBranch) {
      console.log(`[Git Worktree] Checking out to ${defaultBranch}...`);
      await git(projectPath, "checkout", defaultBranch);
    }

    console.log(`[Git Worktree] Squash merging ${branchName}...`);
    await git(projectPath, "merge", "--squash", branchName);

    let hasStagedChanges = false;
    try {
      await git(projectPath, "diff", "--cached", "--quiet");
      hasStagedChanges = false;
    } catch {
      hasStagedChanges = true;
    }

    if (hasStagedChanges) {
      await git(projectPath, ...buildCommitArgs(commitMessage));
      console.log("[Git Worktree] Squash merge committed successfully");
      return { success: true };
    } else {
      console.log("[Git Worktree] No changes to commit - branch has no commits different from main");
      return {
        success: false,
        error: "No changes to merge - branch has no commits different from main",
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Build `git commit` argv with title + optional body separated at the first
// blank line, as distinct -m values. Passing them through argv means no shell
// quoting is required — a message containing $(id), backticks, or newlines
// lands in git as literal text.
export function buildCommitArgs(commitMessage: string): string[] {
  const [title, ...bodyParts] = commitMessage.split("\n\n");
  const body = bodyParts.join("\n\n");
  const args = ["commit", "-m", title];
  if (body) args.push("-m", body);
  return args;
}
