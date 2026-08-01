import { existsSync } from "fs";
import { git } from "./core";
import type { MergeReality } from "@/lib/types";

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

// Tracked, uncommitted changes in a worktree. Untracked files are ignored on
// purpose — Start Dev Server drops a node_modules symlink in there and that is
// not work waiting to be committed. Same `-uno` the merge route uses.
export async function worktreeHasUncommittedChanges(
  worktreePath: string
): Promise<boolean> {
  if (!existsSync(worktreePath)) return false;
  try {
    const { stdout } = await git(worktreePath, "status", "--porcelain", "-uno");
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// Ask git — not the cards table — whether this branch still has anything to
// merge. Two independent signals, because neither alone is enough:
//
//   ahead === 0        the branch has no commit the default branch lacks.
//                      Catches a plain merge, or a branch that never got a
//                      commit at all.
//   contentIdentical   the two tips have the same content. Catches a squash
//                      merge done by hand, whose commits never become
//                      ancestors of the default branch so `ahead` stays > 0.
//
// contentIdentical goes quiet as soon as the default branch moves on for
// unrelated reasons, so it can only ever add a "merged" verdict, never remove
// one. When both signals are silent we report "ready" and let the merge route
// have the final word — a false "ready" costs one clear error message, a false
// "merged" would hide real work.
export async function getMergeReality(
  projectPath: string,
  branchName: string,
  worktreePath?: string | null
): Promise<MergeReality> {
  const defaultBranch = await getDefaultBranch(projectPath);
  const needsCommit = worktreePath
    ? await worktreeHasUncommittedChanges(worktreePath)
    : false;

  const base: MergeReality = {
    branchName,
    defaultBranch,
    exists: false,
    ahead: 0,
    behind: 0,
    contentIdentical: false,
    needsCommit,
    state: "missing",
  };

  if (!(await branchExists(projectPath, branchName))) {
    return base;
  }

  const { ahead, behind } = await getBranchStatus(projectPath, branchName);

  let contentIdentical = false;
  try {
    await git(projectPath, "diff", "--quiet", defaultBranch, branchName, "--");
    contentIdentical = true;
  } catch {
    contentIdentical = false;
  }

  const merged = ahead === 0 || contentIdentical;

  return {
    ...base,
    exists: true,
    ahead,
    behind,
    contentIdentical,
    // Uncommitted work in the worktree is still work: it would be committed
    // and merged, so the branch is not done regardless of what the tips say.
    state: merged && !needsCommit ? "nothing-to-merge" : "ready",
  };
}

// `git diff --cached --quiet` exits non-zero iff there are staged changes.
export async function hasStagedChanges(projectPath: string): Promise<boolean> {
  try {
    await git(projectPath, "diff", "--cached", "--quiet");
    return false;
  } catch {
    return true;
  }
}
