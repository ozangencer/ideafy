import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

// Minimal git helpers used by the ensure_branch tool. Kept separate from
// lib/git.ts because the mcp-server is a standalone package (its own
// rootDir and tsconfig) and cannot import from the Next app tree.
const execFileAsync = promisify(execFile);

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
  return `kanban/${idPrefix}-${taskNumber}-${slugify(title)}`;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(cwd, "rev-parse", "--git-dir");
    return true;
  } catch {
    return false;
  }
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await git(cwd, "branch", "--show-current");
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function branchExists(
  cwd: string,
  branchName: string
): Promise<boolean> {
  try {
    await git(cwd, "show-ref", "--verify", "--quiet", `refs/heads/${branchName}`);
    return true;
  } catch {
    return false;
  }
}

export async function getDefaultBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await git(cwd, "symbolic-ref", "refs/remotes/origin/HEAD");
    return stdout.trim().replace("refs/remotes/origin/", "").replace("refs/heads/", "");
  } catch {
    try {
      await git(cwd, "show-ref", "--verify", "--quiet", "refs/heads/main");
      return "main";
    } catch {
      return "master";
    }
  }
}

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
    if (!existsSync(worktreePath)) return false;
    const { stdout } = await git(projectPath, "worktree", "list", "--porcelain");
    return stdout.includes(`worktree ${worktreePath}`);
  } catch {
    return false;
  }
}

export async function createWorktree(
  projectPath: string,
  branchName: string
): Promise<{ success: boolean; worktreePath: string; error?: string }> {
  const worktreePath = getWorktreePath(projectPath, branchName);
  const baseDir = getWorktreeBaseDir(projectPath);

  try {
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }

    if (await worktreeExists(projectPath, worktreePath)) {
      return { success: true, worktreePath };
    }

    if (await branchExists(projectPath, branchName)) {
      await git(projectPath, "worktree", "add", worktreePath, branchName);
    } else {
      const defaultBranch = await getDefaultBranch(projectPath);
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

    return { success: true, worktreePath };
  } catch (error) {
    return {
      success: false,
      worktreePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Files a card's unmerged work touches, for list_open_work. Measured from the
// merge-base with the default branch, so work that landed on main after the
// branch was cut does not show up as the card's own. With a worktree the diff
// runs inside it against the working tree, so uncommitted edits count too;
// without one it compares the branch tip. Any git failure (missing branch,
// deleted worktree, not a repo) returns [] — the caller skips the card rather
// than failing the whole list.
export async function listChangedFiles(
  repoPath: string,
  opts: { worktreePath?: string | null; branchName?: string | null }
): Promise<string[]> {
  try {
    const defaultBranch = await getDefaultBranch(repoPath);
    let stdout: string;
    if (opts.worktreePath) {
      if (!existsSync(opts.worktreePath)) return [];
      const { stdout: base } = await git(opts.worktreePath, "merge-base", defaultBranch, "HEAD");
      ({ stdout } = await git(opts.worktreePath, "diff", "--name-only", base.trim()));
    } else if (opts.branchName) {
      ({ stdout } = await git(
        repoPath,
        "diff",
        "--name-only",
        `${defaultBranch}...${opts.branchName}`
      ));
    } else {
      return [];
    }
    return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Non-worktree mode: create the branch or check it out in the existing cwd.
// Stashes/restores uncommitted changes so a wrong-branch edit doesn't get
// marooned.
export async function ensureBranchInPlace(
  cwd: string,
  branchName: string
): Promise<{ success: boolean; error?: string }> {
  let didStash = false;
  try {
    const { stdout: statusOutput } = await git(cwd, "status", "--porcelain");
    const hasChanges = statusOutput.trim() !== "";

    if (hasChanges) {
      await git(cwd, "stash", "push", "-m", "ideafy-ensure-branch-stash");
      didStash = true;
    }

    if (await branchExists(cwd, branchName)) {
      await git(cwd, "checkout", branchName);
    } else {
      const defaultBranch = await getDefaultBranch(cwd);
      await git(cwd, "checkout", defaultBranch);
      await git(cwd, "checkout", "-b", branchName);
    }

    if (didStash) {
      try {
        await git(cwd, "stash", "pop");
      } catch {
        return {
          success: true,
          error: "Branch ready but stash could not be applied. Run 'git stash pop' manually.",
        };
      }
    }

    return { success: true };
  } catch (error) {
    if (didStash) {
      try {
        await git(cwd, "stash", "pop");
      } catch {
        // stash remains; surface the original error below
      }
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Mirror of shouldUseWorktree in lib/workspace.ts: a Work project never gets a
// branch, whatever the toggles say. resolveEffectiveWorktree below calls it by
// the same name so the two resolver bodies stay textually identical.
export function shouldUseWorktree(
  card: { useWorktree?: boolean | null },
  project: { useWorktrees?: boolean | null; mode?: string | null } | null | undefined
): boolean {
  if (project?.mode === "work") return false;
  return card.useWorktree ?? project?.useWorktrees ?? true;
}

// Mirror of resolveEffectiveWorktree in lib/hook-policy.ts. That one stayed on
// the app side because it imports generateBranchName from lib/git; this one
// leans on the copy that already lives above. The phase policy the MCP server
// hands back on bind has to carry the same branch clause the hook would inject
// on the next turn, so both sides must answer "what branch should this card be
// on" identically — mcp-server/__tests__/phase-policy.test.ts cross-checks the
// two bodies.
export function resolveEffectiveWorktree(
  card: {
    useWorktree: boolean | null;
    gitBranchName: string | null;
    taskNumber: number | null;
    title: string;
  },
  project: { useWorktrees: boolean; idPrefix: string; mode?: string | null } | null
): { enforced: boolean; targetBranch: string | null } {
  const effective = shouldUseWorktree(card, project);
  if (!effective) return { enforced: false, targetBranch: null };

  if (card.gitBranchName) {
    return { enforced: true, targetBranch: card.gitBranchName };
  }

  if (project && card.taskNumber != null) {
    return {
      enforced: true,
      targetBranch: generateBranchName(project.idPrefix, card.taskNumber, card.title),
    };
  }

  return { enforced: true, targetBranch: null };
}
