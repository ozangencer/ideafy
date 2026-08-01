import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isGitRepo, getMergeReality } from "@/lib/git";
import type { MergeReality } from "@/lib/types";

// What git says about this card's branch right now. The cards table only
// learns a branch was merged when the merge route runs, so a branch merged by
// hand in a terminal leaves the card offering "Merge & Complete" over nothing.
// The card modal asks here before drawing that button.
//
// Read-only: this never writes the card back. The DB flag stays the record of
// what Ideafy did; this is the record of what git contains.
export async function GET(
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

  if (!card.gitBranchName) {
    return NextResponse.json({ error: "Card has no git branch" }, { status: 400 });
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

  let reality: MergeReality;
  try {
    reality = await getMergeReality(
      workingDir,
      card.gitBranchName,
      card.gitWorktreePath
    );
  } catch (error) {
    console.error("[Git Status] Failed to read branch reality:", error);
    return NextResponse.json(
      {
        error: "Could not read branch status",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }

  return NextResponse.json(reality);
}
