import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isGitRepo, findCardBranch, getMergeReality } from "@/lib/git";

// Reclaim a branch the card lost track of. A run that died before writing its
// git fields — or work that went on in the worktree by chat or terminal —
// leaves a card in Human Test that looks branchless, so the modal offers a
// bare Complete while real commits sit unmerged on kanban/<PREFIX>-<n>-….
//
// The card modal calls this when a Human Test card has no branch. It binds the
// branch only when exactly one matches the card's prefix and there is still
// something to merge; anything less certain leaves the card as it is.
//
// updatedAt is left alone on purpose: git fields are not form fields, and
// bumping it would make the open form's next save look stale.
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

  // Already bound — hand the fields back so a modal holding a stale copy of
  // the card can catch up instead of drawing the branchless panel.
  if (card.gitBranchName) {
    return NextResponse.json({
      linked: true,
      gitBranchName: card.gitBranchName,
      gitBranchStatus: card.gitBranchStatus,
      gitWorktreePath: card.gitWorktreePath,
      gitWorktreeStatus: card.gitWorktreeStatus,
    });
  }

  const project = card.projectId
    ? db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, card.projectId))
        .get()
    : null;

  if (!project || !card.taskNumber) {
    return NextResponse.json({ linked: false, reason: "no-display-id" });
  }

  const workingDir = project.folderPath || card.projectFolder || process.cwd();

  if (!(await isGitRepo(workingDir))) {
    return NextResponse.json({ linked: false, reason: "not-a-repo" });
  }

  try {
    const found = await findCardBranch(workingDir, project.idPrefix, card.taskNumber);
    if (!found) {
      return NextResponse.json({ linked: false, reason: "no-unique-branch" });
    }

    const reality = await getMergeReality(workingDir, found.branchName, found.worktreePath);
    if (reality.state !== "ready") {
      return NextResponse.json({ linked: false, reason: reality.state });
    }

    const fields = {
      gitBranchName: found.branchName,
      gitBranchStatus: "active" as const,
      gitWorktreePath: found.worktreePath,
      gitWorktreeStatus: found.worktreePath ? ("active" as const) : null,
    };

    db.update(schema.cards)
      .set(fields)
      .where(eq(schema.cards.id, id))
      .run();

    console.log(`[Git Link] Bound ${found.branchName} to card ${id}`);
    return NextResponse.json({ linked: true, ...fields });
  } catch (error) {
    console.error("[Git Link] Failed to look up the card's branch:", error);
    return NextResponse.json(
      {
        error: "Could not look up the card's branch",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
