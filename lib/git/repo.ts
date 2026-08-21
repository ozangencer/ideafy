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

/**
 * Commits sitting on the local default branch that the remote has not seen.
 *
 * Merging a card lands its work on the *local* default branch and stops there —
 * nothing is pushed. A card reading "Completed" therefore says nothing about
 * whether the work left this machine, which is exactly the gap this reports.
 *
 * The comparison is against the cached `origin/<branch>` ref, so it answers
 * "not in the origin I last heard about". Callers wanting a current answer
 * should fetch first.
 */
export interface UnpushedCommit {
  hash: string;
  subject: string;
  /** ISO 8601 commit date. */
  date: string;
  /**
   * Everything below the subject line. Carried because that is where a
   * `Card: IDE-283` trailer lives — the subject stays free-form prose.
   */
  body: string;
}

export interface UnpushedStatus {
  /** False when the project has no remote to be behind — nothing to report. */
  supported: boolean;
  defaultBranch: string;
  count: number;
  commits: UnpushedCommit[];
}

const UNSUPPORTED: UnpushedStatus = {
  supported: false,
  defaultBranch: "",
  count: 0,
  commits: [],
};

/** Refresh the cached remote refs. Best-effort: offline is not an error here. */
export async function fetchRemote(projectPath: string): Promise<boolean> {
  try {
    await git(projectPath, "fetch", "--quiet", "origin");
    return true;
  } catch {
    return false;
  }
}

export async function getUnpushedStatus(
  projectPath: string,
  options: { withCommits?: boolean } = {}
): Promise<UnpushedStatus> {
  if (!existsSync(projectPath) || !(await isGitRepo(projectPath))) return UNSUPPORTED;

  try {
    const { stdout: remotes } = await git(projectPath, "remote");
    if (!remotes.trim()) return UNSUPPORTED;
  } catch {
    return UNSUPPORTED;
  }

  const defaultBranch = await getDefaultBranch(projectPath);
  const remoteRef = `refs/remotes/origin/${defaultBranch}`;

  // A repo the remote has never seen has no "unpushed" answer worth giving —
  // every commit would count, which is noise rather than a warning. One
  // remote-tracking ref is enough to prove the remote is real; this one is
  // the ref every clone has.
  try {
    await git(projectPath, "show-ref", "--verify", "--quiet", remoteRef);
  } catch {
    return UNSUPPORTED;
  }

  // Every commit on every local branch that no remote-tracking ref carries —
  // the whole of what would be lost with the disk, and nothing else.
  //
  // Deliberately not `origin/<default>..<default>`: Ideafy's own workflow parks
  // work on a kanban/IDE-xxx branch for days, and a badge watching only the
  // default branch stays silent for exactly as long as the work exists nowhere
  // but this machine — silent when it matters most.
  //
  // `--not --remotes` rather than `origin/<default>..HEAD` for the other half
  // of the same question: a feature branch that HAS been pushed is safe, and
  // comparing it against origin/main would count its commits anyway and cry
  // wolf. Asking "is this on any remote" answers both cases with one range.
  //
  // `--branches` rather than HEAD plus the default branch, which was the first
  // answer here and was too narrow: it went quiet about every branch the user
  // was not standing on. Measured across this machine's own projects, one repo
  // held seventeen commits that existed nowhere else and the badge reported
  // one. The objection to counting them — that a branch abandoned months ago
  // would light the badge forever — does not survive contact with that number:
  // a branch you will never push is one to delete, and until you do, "there is
  // work here and nowhere else" is a true statement, not noise.
  //
  // HEAD is named alongside because a detached HEAD is on no branch at all.
  const revArgs = ["HEAD", "--branches", "--not", "--remotes"];

  try {
    if (!options.withCommits) {
      const { stdout } = await git(projectPath, "rev-list", "--count", ...revArgs);
      return {
        supported: true,
        defaultBranch,
        count: Number.parseInt(stdout.trim(), 10) || 0,
        commits: [],
      };
    }

    // Unit separator between fields, record separator between commits. The
    // body spans newlines, so splitting commits on "\n" — which is what this
    // did before the body was carried — would shred every multi-line message.
    const { stdout } = await git(
      projectPath,
      "log",
      "--pretty=format:%H%x1f%s%x1f%cI%x1f%b%x1e",
      ...revArgs
    );

    const commits: UnpushedCommit[] = stdout
      .split("\x1e")
      .filter((record) => record.trim() !== "")
      .map((record) => {
        const [hash, subject, date, body] = record.replace(/^\n/, "").split("\x1f");
        return {
          hash: hash ?? "",
          subject: subject ?? "",
          date: date ?? "",
          body: (body ?? "").trim(),
        };
      });

    return { supported: true, defaultBranch, count: commits.length, commits };
  } catch {
    return UNSUPPORTED;
  }
}
