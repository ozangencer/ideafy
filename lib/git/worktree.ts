import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { git, buildCommitArgs } from "./core";
import {
  branchExists,
  getCurrentBranch,
  getDefaultBranch,
  hasStagedChanges,
} from "./repo";

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
 * Create a new worktree for a branch.
 * If the branch doesn't exist, creates it from the default branch.
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

    if (await worktreeExists(projectPath, worktreePath)) {
      console.log(`[Git Worktree] Worktree already exists: ${worktreePath}`);
      return { success: true, worktreePath };
    }

    if (await branchExists(projectPath, branchName)) {
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
    if (!(await worktreeExists(projectPath, worktreePath))) {
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
 * Squash merge from a worktree branch into the default branch.
 * Works from the main repository, not the worktree.
 */
export async function squashMergeFromWorktree(
  projectPath: string,
  branchName: string,
  commitMessage: string
): Promise<{ success: boolean; error?: string; uncommittedInMain?: boolean }> {
  try {
    const { stdout: statusOutput } = await git(projectPath, "status", "--porcelain");
    if (statusOutput.trim() !== "") {
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

    if (await hasStagedChanges(projectPath)) {
      await git(projectPath, ...buildCommitArgs(commitMessage));
      console.log("[Git Worktree] Squash merge committed successfully");
      return { success: true };
    }

    console.log("[Git Worktree] No changes to commit - branch has no commits different from main");
    return {
      success: false,
      error: "No changes to merge - branch has no commits different from main",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
