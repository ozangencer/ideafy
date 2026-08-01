import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fetchRemote, getUnpushedStatus } from "@/lib/git";

/**
 * The commits on this project's default branch that origin has not seen, each
 * carrying its own subject line, plus the card it came from where one can be
 * identified.
 *
 * Cards are an enrichment, never the unit. Ideafy writes `feat(DIC-9): title`
 * when it merges, but most commits in a real repo are made by hand and carry no
 * card at all — listing only card-shaped commits would report "nothing to push"
 * while a dozen sit waiting. Every commit is listed; some just get a badge.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .get();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const shouldFetch = new URL(request.url).searchParams.get("fetch") === "1";
  let fetched = false;
  if (shouldFetch) {
    fetched = await fetchRemote(project.folderPath);
  }

  const status = await getUnpushedStatus(project.folderPath, { withCommits: true });

  // Only this project's own prefix counts — a subject mentioning another
  // project's card would otherwise link somewhere confusing.
  const prefix = project.idPrefix.toUpperCase();
  const cardRef = new RegExp(`\\(${prefix}-(\\d+)\\)`, "i");

  const commits = status.commits.map((commit) => {
    const match = commit.subject.match(cardRef);
    if (!match) return { ...commit, card: null };

    const taskNumber = Number.parseInt(match[1], 10);
    const card = db
      .select({
        id: schema.cards.id,
        title: schema.cards.title,
        status: schema.cards.status,
      })
      .from(schema.cards)
      .where(
        and(
          eq(schema.cards.projectId, project.id),
          eq(schema.cards.taskNumber, taskNumber)
        )
      )
      .get();

    return {
      ...commit,
      // The commit may name a card that has since been deleted; the badge is
      // still true, it just cannot be opened.
      card: card
        ? { id: card.id, displayId: `${prefix}-${taskNumber}`, title: card.title }
        : null,
    };
  });

  return NextResponse.json({
    supported: status.supported,
    defaultBranch: status.defaultBranch,
    count: status.count,
    fetched,
    commits,
  });
}
