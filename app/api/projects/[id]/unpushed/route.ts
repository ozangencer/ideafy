import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fetchRemote, getUnpushedStatus } from "@/lib/git";

/**
 * The commits on this project's default branch that origin has not seen, each
 * carrying its own subject line, plus the cards it came from where any can be
 * identified.
 *
 * Cards are an enrichment, never the unit. Most commits in a real repo are made
 * by hand and carry no card at all — listing only card-shaped commits would
 * report "nothing to push" while a dozen sit waiting. Every commit is listed;
 * some just get a badge.
 *
 * A commit can name more than one card — a merge that closes three of them, a
 * change that serves two — so the answer is a list, not a single card.
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

  // Two rules, because the history holds four shapes and no more precision is
  // available than this:
  //
  //   Card: IDE-283            the trailer Ideafy now asks for — body only
  //   feat(IDE-283): …         the conventional prefix merges still write
  //   Merge kanban/IDE-283-…   a branch name that reached a merge subject
  //   Merge IDE-283: …         a hand-written merge
  //
  // The last three are all just "the ID appears in the subject", so the subject
  // rule is that and nothing narrower. Measured over 335 commits of this repo's
  // history it costs zero false positives, and a subject that names a card is
  // about that card. Any over-match is caught downstream anyway: a task number
  // with no row behind it produces no badge.
  //
  // The body is trailers only. Prose mentions a card in passing far too often
  // ("follows on from IDE-270") for the same rule to hold there.
  //
  // A range is never inferred. generateBranchName emits `kanban/IDE-283-<slug>`,
  // so digits after the number belong to a title — reading `IDE-283-285` as
  // "283 through 285" would invent cards out of `kanban/IDE-283-2-column-fix`.
  const patterns: [RegExp, "subject" | "body"][] = [
    [new RegExp(`^\\s*Card:\\s*${prefix}-(\\d+)\\s*$`, "gim"), "body"],
    [new RegExp(`\\b${prefix}-(\\d+)\\b`, "gi"), "subject"],
  ];

  const commits = status.commits.map((commit) => {
    // Set, not array: a commit that names the same card in two shapes — a
    // trailer plus the branch it merged — is still one badge.
    const taskNumbers = new Set<number>();
    for (const [pattern, field] of patterns) {
      for (const match of commit[field].matchAll(pattern)) {
        taskNumbers.add(Number.parseInt(match[1], 10));
      }
    }

    const cards = [...taskNumbers]
      .map((taskNumber) => {
        const card = db
          .select({
            id: schema.cards.id,
            title: schema.cards.title,
          })
          .from(schema.cards)
          .where(
            and(
              eq(schema.cards.projectId, project.id),
              eq(schema.cards.taskNumber, taskNumber)
            )
          )
          .get();

        // The commit may name a card that has since been deleted. Without a
        // card there is nothing to open and no title to show, so the row is
        // better off bare than carrying a badge that goes nowhere.
        return card
          ? { id: card.id, displayId: `${prefix}-${taskNumber}`, title: card.title }
          : null;
      })
      .filter((card) => card !== null);

    // The body was read for its trailers and has no job on the client.
    const { body: _body, ...rest } = commit;
    return { ...rest, cards };
  });

  return NextResponse.json({
    supported: status.supported,
    defaultBranch: status.defaultBranch,
    count: status.count,
    fetched,
    commits,
  });
}
