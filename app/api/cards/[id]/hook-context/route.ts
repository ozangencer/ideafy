import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { buildPhasePolicy, isTerminalPhase } from "@/lib/hook-policy";
import { normalizeProjectMode } from "@/lib/project-serialize";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const row = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();

  if (!row) {
    return new Response(null, { status: 204 });
  }

  if (isTerminalPhase(row.status)) {
    return new Response(null, { status: 204 });
  }

  // Only for the display ID the commit-trailer clause needs and the mode that
  // decides whether that clause appears; the branch clause this route omits is
  // what the full hook-context endpoint adds on top.
  const project = row.projectId
    ? db
        .select({ idPrefix: schema.projects.idPrefix, mode: schema.projects.mode })
        .from(schema.projects)
        .where(eq(schema.projects.id, row.projectId))
        .get()
    : null;

  const body = buildPhasePolicy(
    {
      id: row.id,
      title: row.title,
      status: row.status,
      displayId:
        project && row.taskNumber ? `${project.idPrefix}-${row.taskNumber}` : null,
    },
    undefined,
    normalizeProjectMode(project?.mode)
  );

  if (!body) {
    return new Response(null, { status: 204 });
  }

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
