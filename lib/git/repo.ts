import { git } from "./core";

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

// `git diff --cached --quiet` exits non-zero iff there are staged changes.
export async function hasStagedChanges(projectPath: string): Promise<boolean> {
  try {
    await git(projectPath, "diff", "--cached", "--quiet");
    return false;
  } catch {
    return true;
  }
}
