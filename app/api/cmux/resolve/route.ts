import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  cacheCmuxWorkspaces,
  decideCmuxPlacement,
  isBootstrapWorkspace,
  parseCmuxWorkspaceList,
} from "@/lib/terminal/cmux";

// The answer depends on what cmux has open right now, so it must not be cached.
export const dynamic = "force-dynamic";

// POST /api/cmux/resolve?projectId=<id>&folder=<path>
//
// Called by the bootstrap script Ideafy opens inside cmux — the only process
// allowed to talk to the cmux socket, and therefore the only one that can read
// the workspace list. It posts that list here so the placement decision stays
// in TypeScript next to the rules it implements.
//
// The reply is plain text on purpose: the caller is a shell script, and macOS
// does not guarantee a JSON reader on PATH. One of:
//   <uuid>  move this tab into that workspace
//   keep    adopt the fresh workspace and pin it to the project
//   stay    leave it alone (the project asked for a fresh workspace per run)
export async function POST(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  const folderParam = request.nextUrl.searchParams.get("folder");

  const project = projectId
    ? db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .get()
    : null;

  // What the bootstrap reports includes the workspace cmux opened to run the
  // bootstrap itself, which is about to be renamed or closed. It has no
  // business in the cache the settings picker reads, and it could never win a
  // placement decision anyway — no project can be pinned to an id created this
  // run, and its directory is tmp — so drop it before either step sees it.
  const reported = parseCmuxWorkspaceList(await request.text());
  const workspaces = reported.filter(
    (w) => !isBootstrapWorkspace(w, request.headers.get("x-cmux-self-workspace")),
  );

  // Every launch refreshes this, which is what keeps the project settings
  // picker populated for an Ideafy that cannot reach the socket itself. The
  // guard is on what was reported, not on what survived the filter: a bootstrap
  // alone in cmux legitimately leaves no workspaces to offer, and that is worth
  // recording. An unreadable list is not.
  if (reported.length > 0) cacheCmuxWorkspaces(workspaces);

  const placement = decideCmuxPlacement(
    workspaces,
    project?.folderPath ?? folderParam,
    project?.cmuxWorkspaceId ?? null,
  );

  const reply = placement.kind === "move" ? placement.workspaceId : placement.kind;
  return new NextResponse(reply, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
