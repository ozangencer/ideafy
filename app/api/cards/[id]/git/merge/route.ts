import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  squashMergeFromWorktree,
  isGitRepo,
  removeWorktree,
  pruneWorktrees,
  getDefaultBranch,
  git,
} from "@/lib/git";
import { existsSync, readFileSync, realpathSync } from "fs";
import path from "path";
import { stopDevServer, isProcessRunning } from "@/lib/dev-server";
import type { Status } from "@/lib/types";

function isCwdInsideWorktree(worktreePath: string): boolean {
  const resolve = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const cwd = resolve(process.cwd());
  const wt = resolve(worktreePath);
  if (cwd === wt) return true;
  return cwd.startsWith(wt + path.sep);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Parse request body for options
  let commitFirst = false;
  try {
    const body = await request.json();
    commitFirst = body.commitFirst === true;
  } catch {
    // No body or invalid JSON - use defaults
  }

  // Get the card from database
  const card = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();

  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  // Verify card is in test status
  if (card.status !== "test") {
    return NextResponse.json(
      { error: "Merge is only available for cards in Human Test column" },
      { status: 400 }
    );
  }

  // Verify card has a git branch
  if (!card.gitBranchName) {
    return NextResponse.json(
      { error: "Card has no git branch to merge" },
      { status: 400 }
    );
  }

  // Guard: refuse to merge when the request is served from inside the card's
  // own worktree. Merge would kill this process and delete the directory it
  // serves from, producing an opaque failure mid-flight.
  if (card.gitWorktreePath && isCwdInsideWorktree(card.gitWorktreePath)) {
    return NextResponse.json(
      {
        error:
          "Merge & Complete cannot run from this card's isolated dev server. Open the main Ideafy instance (http://localhost:3030) and merge from there.",
        ranFromWorktree: true,
        worktreePath: card.gitWorktreePath,
      },
      { status: 400 }
    );
  }

  // Get project for working directory
  const project = card.projectId
    ? db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, card.projectId))
        .get()
    : null;

  const workingDir = project?.folderPath || card.projectFolder || process.cwd();

  // Verify it's a git repo
  const isRepo = await isGitRepo(workingDir);
  if (!isRepo) {
    return NextResponse.json(
      { error: "Project directory is not a git repository" },
      { status: 400 }
    );
  }

  console.log(`[Merge] Starting squash merge for card ${id}`);
  console.log(`[Merge] Branch: ${card.gitBranchName}`);
  console.log(`[Merge] Working dir: ${workingDir}`);

  // Stop dev server if running
  if (card.devServerPid && isProcessRunning(card.devServerPid)) {
    console.log(`[Merge] Stopping dev server with PID ${card.devServerPid}`);
    stopDevServer(card.devServerPid);
  }

  // Build commit message
  const displayId = project
    ? `${project.idPrefix}-${card.taskNumber}`
    : `TASK-${card.taskNumber || "X"}`;

  const commitMessage = `feat(${displayId}): ${card.title}\n\nSquash merge from branch: ${card.gitBranchName}`;

  let mainStashed = false;
  const stashMessage = `kanban-merge-stash-${id}-${Date.now()}`;

  const restoreMainStash = async (): Promise<string | null> => {
    if (!mainStashed) return null;
    try {
      await git(workingDir, "stash", "pop");
      mainStashed = false;
      console.log(`[Merge] Main repo stashed changes restored`);
      return null;
    } catch (popError) {
      const msg = popError instanceof Error ? popError.message : String(popError);
      console.error(`[Merge] Stash pop failed: ${msg}`);
      return `Stash could not be restored automatically. Changes remain in stash (message: "${stashMessage}"). Run 'git stash list' and resolve manually.`;
    }
  };

  try {
    // Step 0: Check if there's an ongoing rebase conflict in worktree
    if (card.gitWorktreePath && existsSync(card.gitWorktreePath)) {
      // For worktrees, .git is a file pointing to the actual git directory
      let gitDir = `${card.gitWorktreePath}/.git`;
      const gitFile = `${card.gitWorktreePath}/.git`;
      if (existsSync(gitFile)) {
        try {
          const gitDirContent = readFileSync(gitFile, "utf-8");
          const match = gitDirContent.match(/gitdir:\s*(.+)/);
          if (match) {
            gitDir = match[1].trim();
          }
        } catch {
          // Use default
        }
      }

      const rebaseInProgress = existsSync(`${gitDir}/rebase-merge`) ||
                               existsSync(`${gitDir}/rebase-apply`);

      if (rebaseInProgress) {
        console.log(`[Merge] Ongoing rebase detected in worktree`);

        // Get conflict files
        let conflictFiles: string[] = [];
        try {
          const { stdout: conflictOutput } = await git(
            card.gitWorktreePath,
            "diff",
            "--name-only",
            "--diff-filter=U"
          );
          conflictFiles = conflictOutput.trim().split('\n').filter(f => f);
        } catch {
          // Try alternative method
          try {
            const { stdout: statusOutput } = await git(
              card.gitWorktreePath,
              "status",
              "--porcelain"
            );
            conflictFiles = statusOutput
              .split('\n')
              .filter(line => line.startsWith('UU ') || line.startsWith('AA ') || line.startsWith('DD '))
              .map(line => line.substring(3));
          } catch {
            // Ignore
          }
        }

        // Update card with conflict status if not already set
        if (!card.rebaseConflict) {
          db.update(schema.cards)
            .set({
              rebaseConflict: true,
              conflictFiles: JSON.stringify(conflictFiles),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.cards.id, id))
            .run();
        }

        return NextResponse.json(
          {
            error: "Rebase conflict detected",
            rebaseConflict: true,
            conflictFiles,
            worktreePath: card.gitWorktreePath,
            branchName: card.gitBranchName,
            cardId: id,
            displayId,
          },
          { status: 409 }
        );
      }
    }

    // Step 1: Check for uncommitted tracked changes in worktree
    // Ignore untracked files (e.g. node_modules symlink created by Start Dev Server)
    if (card.gitWorktreePath && existsSync(card.gitWorktreePath)) {
      console.log(`[Merge] Checking for uncommitted tracked changes in worktree: ${card.gitWorktreePath}`);
      try {
        const { stdout: worktreeStatus } = await git(
          card.gitWorktreePath,
          "status",
          "--porcelain",
          "-uno"
        );
        if (worktreeStatus.trim()) {
          if (commitFirst) {
            console.log(`[Merge] Committing tracked modifications in worktree...`);
            await git(card.gitWorktreePath, "add", "-u");
            await git(card.gitWorktreePath, "commit", "-m", "chore: WIP before merge");
            console.log(`[Merge] Worktree changes committed`);
          } else {
            console.log(`[Merge] Found uncommitted changes in worktree, asking user`);
            return NextResponse.json(
              {
                error: "Worktree'de commit edilmemiş değişiklikler var.",
                uncommittedInWorktree: true,
                worktreePath: card.gitWorktreePath,
              },
              { status: 400 }
            );
          }
        }
      } catch (statusError) {
        console.warn(`[Merge] Could not check worktree status: ${statusError}`);
      }
    }

    // Step 2: Check if branch has commits different from main
    const defaultBranch = await getDefaultBranch(workingDir);
    console.log(`[Merge] Checking commit count between ${defaultBranch} and ${card.gitBranchName}`);
    try {
      const { stdout: commitCount } = await git(
        workingDir,
        "rev-list",
        "--count",
        `${defaultBranch}..${card.gitBranchName}`
      );
      const count = parseInt(commitCount.trim(), 10);
      console.log(`[Merge] Branch has ${count} commits ahead of ${defaultBranch}`);
      if (count === 0) {
        return NextResponse.json(
          {
            error: "No commits to merge - branch has no changes.",
            noCommits: true,
          },
          { status: 400 }
        );
      }
    } catch (countError) {
      console.warn(`[Merge] Could not check commit count: ${countError}`);
      // Continue anyway - we'll let the squash merge handle it
    }

    // Step 3: Stash uncommitted changes in main repo (restored after merge)
    const { stdout: mainStatus } = await git(workingDir, "status", "--porcelain");
    if (mainStatus.trim()) {
      console.log(`[Merge] Stashing uncommitted changes in main repo...`);
      await git(
        workingDir,
        "stash",
        "push",
        "--include-untracked",
        "-m",
        stashMessage
      );
      mainStashed = true;
      console.log(`[Merge] Main repo changes stashed as "${stashMessage}"`);
    }

    // Step 4: Rebase branch onto main (in worktree) to detect conflicts early
    if (card.gitWorktreePath && existsSync(card.gitWorktreePath)) {
      console.log(`[Merge] Rebasing branch onto ${defaultBranch} in worktree...`);
      try {
        // Rebase onto local main (not origin/main) to include local unpushed commits
        await git(card.gitWorktreePath, "rebase", defaultBranch);
        console.log(`[Merge] Rebase successful`);
      } catch (rebaseError) {
        const errorMsg = rebaseError instanceof Error ? rebaseError.message : String(rebaseError);
        console.error(`[Merge] Rebase failed: ${errorMsg}`);

        // Check if it's a conflict
        if (errorMsg.includes('CONFLICT') || errorMsg.includes('could not apply')) {
          // Get list of conflicting files
          let conflictFiles: string[] = [];
          try {
            const { stdout: conflictOutput } = await git(
              card.gitWorktreePath,
              "diff",
              "--name-only",
              "--diff-filter=U"
            );
            conflictFiles = conflictOutput.trim().split('\n').filter(f => f);
          } catch {
            // Ignore error getting conflict files
          }

          // Update card with conflict status
          db.update(schema.cards)
            .set({
              rebaseConflict: true,
              conflictFiles: JSON.stringify(conflictFiles),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.cards.id, id))
            .run();

          console.log(`[Merge] Conflict detected in files: ${conflictFiles.join(', ')}`);

          const stashRestoreWarning = await restoreMainStash();
          return NextResponse.json(
            {
              error: "Rebase conflict detected",
              rebaseConflict: true,
              conflictFiles,
              worktreePath: card.gitWorktreePath,
              branchName: card.gitBranchName,
              cardId: id,
              displayId,
              stashRestoreWarning,
            },
            { status: 409 }
          );
        }

        // Other rebase error - abort and return
        try {
          await git(card.gitWorktreePath, "rebase", "--abort");
        } catch {
          // Ignore abort errors
        }

        const stashRestoreWarning = await restoreMainStash();
        return NextResponse.json(
          { error: `Rebase failed: ${errorMsg}`, stashRestoreWarning },
          { status: 500 }
        );
      }
    }

    // Step 5: Squash merge the branch into main (from the main repo)
    console.log(`[Merge] Squash merging branch: ${card.gitBranchName}`);
    const result = await squashMergeFromWorktree(workingDir, card.gitBranchName, commitMessage);

    if (!result.success) {
      console.error(`[Merge] Failed: ${result.error}`);
      const stashRestoreWarning = await restoreMainStash();
      return NextResponse.json(
        { error: `Merge failed: ${result.error}`, stashRestoreWarning },
        { status: 500 }
      );
    }

    // Step 6: Remove worktree AFTER successful merge
    if (card.gitWorktreePath) {
      console.log(`[Merge] Removing worktree: ${card.gitWorktreePath}`);
      const removeResult = await removeWorktree(workingDir, card.gitWorktreePath);
      if (!removeResult.success) {
        console.warn(`[Merge] Failed to remove worktree: ${removeResult.error}`);
        // Continue anyway - the worktree might have been deleted manually
      }
    }

    // Step 7: Delete the branch AFTER successful merge
    console.log(`[Merge] Deleting branch: ${card.gitBranchName}`);
    try {
      await git(workingDir, "branch", "-D", "--", card.gitBranchName);
    } catch (branchError) {
      console.warn(`[Merge] Failed to delete branch: ${branchError}`);
      // Continue anyway - branch deletion is not critical
    }

    // Step 8: Prune any orphan worktrees
    await pruneWorktrees(workingDir);

    console.log(`[Merge] Success - branch merged, worktree removed, branch deleted`);

    // Update card - move to completed, clear git info
    const updatedAt = new Date().toISOString();
    const completedAt = new Date().toISOString();
    const newStatus: Status = "completed";

    db.update(schema.cards)
      .set({
        status: newStatus,
        // Keep gitBranchName for reference, update status
        gitBranchStatus: "merged",
        gitWorktreeStatus: "removed",
        // Clear dev server info
        devServerPort: null,
        devServerPid: null,
        // Clear conflict info
        rebaseConflict: null,
        conflictFiles: null,
        updatedAt,
        completedAt,
      })
      .where(eq(schema.cards.id, id))
      .run();

    const stashRestoreWarning = await restoreMainStash();

    return NextResponse.json({
      success: true,
      cardId: id,
      newStatus,
      message: `Branch ${card.gitBranchName} merged, worktree removed, branch deleted`,
      stashRestoreWarning,
    });
  } catch (error) {
    console.error("[Merge] Error:", error);
    const stashRestoreWarning = await restoreMainStash();
    return NextResponse.json(
      {
        error: "Merge failed",
        details: error instanceof Error ? error.message : String(error),
        stashRestoreWarning,
      },
      { status: 500 }
    );
  }
}
