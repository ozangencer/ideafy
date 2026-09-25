import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { EnrichInputError, runEnrich } from "@/lib/ai/run-enrich";

/**
 * Enrich for a card that has no row yet (the create modal's draft). The saved
 * card route reads project and platform off the card; here the form sends them.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const currentValue: string = typeof body?.currentValue === "string" ? body.currentValue : "";
  const projectId: string | null = typeof body?.projectId === "string" ? body.projectId : null;
  const aiPlatform: string | null = typeof body?.aiPlatform === "string" ? body.aiPlatform : null;

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const project = db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 400 });
  }

  try {
    const result = await runEnrich({ currentValue, projectId, aiPlatform });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof EnrichInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Enrich] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
