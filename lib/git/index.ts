// Barrel for the `@/lib/git` module. Keeps the public API stable while the
// implementation is split across core / repo / branch / worktree.

export { git, slugify, generateBranchName, buildCommitArgs } from "./core";
export {
  isGitRepo,
  getCurrentBranch,
  branchExists,
  getDefaultBranch,
  getBranchStatus,
} from "./repo";
export { createBranch, squashMerge, rollback, checkoutBranch } from "./branch";
export {
  getWorktreeBaseDir,
  getWorktreePath,
  worktreeExists,
  listWorktrees,
  createWorktree,
  removeWorktree,
  pruneWorktrees,
  squashMergeFromWorktree,
} from "./worktree";
