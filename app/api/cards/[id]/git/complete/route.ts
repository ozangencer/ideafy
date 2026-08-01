import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  isGitRepo,
  getMergeReality,
  removeWorktree,
  isCwdInsideWorktree,
  pruneWorktrees,
  branchExists,
  git,
} from "@/lib/git";
import { stopDevServer, isProcessRunning } from "@/lib/dev-server";
import type { Status } from "@/lib/types";

// Close out a card whose branch is already in the default branch — merged by
// hand in a terminal, or by an agent that ran `git merge` itself. There is
// nothing left to squash, so this does the bookkeeping half of the merge
// route: tear down the worktree and branch, mark the card completed.
//
// The "nothing to merge" verdict is recomputed here rather than trusted from
// the client. The modal's copy of it can be seconds old, and by then a commit
// may have landed on the branch.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const card = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();

  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  if (card.status !== "test") {
    return NextResponse.json(
      { error: "Complete is only available for cards in Human Test column" },
      { status: 400 }
    );
  }

  if (!card.gitBranchName) {
    return NextResponse.json(
      { error: "Card has no git branch" },
      { status: 400 }
    );
  }

  // Same guard as merge: removing the worktree would delete the directory this
  // server is running from.
  if (card.gitWorktreePath && isCwdInsideWorktree(card.gitWorktreePath)) {
    return NextResponse.json(
      {
        error:
          "Complete cannot run from this card's isolated dev server. Open the main Ideafy instance (http://localhost:3030) and complete from there.",
        ranFromWorktree: true,
        worktreePath: card.gitWorktreePath,
      },
      { status: 400 }
    );
  }

  const project = card.projectId
    ? db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, card.projectId))
        .get()
    : null;

  const workingDir = project?.folderPath || card.projectFolder || process.cwd();

  if (!(await isGitRepo(workingDir))) {
    return NextResponse.json(
      { error: "Project directory is not a git repository" },
      { status: 400 }
    );
  }

  try {
    const reality = await getMergeReality(
      workingDir,
      card.gitBranchName,
      card.gitWorktreePath
    );

    if (reality.state === "ready") {
      return NextResponse.json(
        {
          error: reality.needsCommit
            ? "Worktree'de commit edilmemiş değişiklikler var — Merge & Complete kullanın."
            : "Branch'te merge edilmemiş commit'ler var — Merge & Complete kullanın.",
          state: reality.state,
          reality,
        },
        { status: 400 }
      );
    }

    if (card.devServerPid && isProcessRunning(card.devServerPid)) {
      console.log(`[Complete] Stopping dev server with PID ${card.devServerPid}`);
      stopDevServer(card.devServerPid);
    }

    if (card.gitWorktreePath) {
      console.log(`[Complete] Removing worktree: ${card.gitWorktreePath}`);
      const removeResult = await removeWorktree(workingDir, card.gitWorktreePath);
      if (!removeResult.success) {
        console.warn(`[Complete] Failed to remove worktree: ${removeResult.error}`);
        // Continue anyway - the worktree might have been deleted manually
      }
    }

    if (await branchExists(workingDir, card.gitBranchName)) {
      console.log(`[Complete] Deleting branch: ${card.gitBranchName}`);
      try {
        await git(workingDir, "branch", "-D", "--", card.gitBranchName);
      } catch (branchError) {
        console.warn(`[Complete] Failed to delete branch: ${branchError}`);
        // Continue anyway - branch deletion is not critical
      }
    }

    await pruneWorktrees(workingDir);

    const now = new Date().toISOString();
    const newStatus: Status = "completed";

    db.update(schema.cards)
      .set({
        status: newStatus,
        gitBranchStatus: "merged",
        gitWorktreeStatus: "removed",
        devServerPort: null,
        devServerPid: null,
        rebaseConflict: null,
        conflictFiles: null,
        updatedAt: now,
        completedAt: now,
      })
      .where(eq(schema.cards.id, id))
      .run();

    console.log(
      `[Complete] Card ${id} completed without merging (${reality.state})`
    );

    return NextResponse.json({
      success: true,
      cardId: id,
      newStatus,
      state: reality.state,
      message:
        reality.state === "missing"
          ? `Branch ${card.gitBranchName} no longer exists, card completed`
          : `Branch ${card.gitBranchName} was already merged, card completed`,
    });
  } catch (error) {
    console.error("[Complete] Error:", error);
    return NextResponse.json(
      {
        error: "Complete failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
