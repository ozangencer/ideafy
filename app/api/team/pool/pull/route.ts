import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSupabaseAdmin, getAuthenticatedUser } from "@/lib/team/server";

// POST: Pull a pool card into local SQLite
export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request.headers.get("Authorization"));
  if (authError || !user) {
    return NextResponse.json({ error: authError || "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin()!;

  const body = await request.json();
  const { poolCardId } = body;

  if (!poolCardId) {
    return NextResponse.json({ error: "poolCardId is required" }, { status: 400 });
  }

  const { data: poolCard, error: poolError } = await supabase
    .from("pool_cards")
    .select("*")
    .eq("id", poolCardId)
    .single();

  if (poolError || !poolCard) {
    return NextResponse.json({ error: "Pool card not found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  // Try to match pool card's project_name to a local project
  let matchedProjectId: string | null = null;
  let matchedProjectFolder = "";
  if (poolCard.project_name) {
    const localProject = db
      .select()
      .from(schema.projects)
      .where(sql`lower(${schema.projects.name}) = lower(${poolCard.project_name})`)
      .get();
    if (localProject) {
      matchedProjectId = localProject.id;
      matchedProjectFolder = localProject.folderPath || "";
    }
  }

  const newCard = {
    id: uuidv4(),
    title: poolCard.title,
    description: poolCard.description || "",
    solutionSummary: poolCard.solution_summary || "",
    testScenarios: poolCard.test_scenarios || "",
    aiOpinion: poolCard.ai_opinion || "",
    aiVerdict: poolCard.ai_verdict || null,
    status: poolCard.status || "backlog",
    complexity: poolCard.complexity || "medium",
    priority: poolCard.priority || "medium",
    projectFolder: matchedProjectFolder,
    projectId: matchedProjectId,
    taskNumber: null,
    gitBranchName: null,
    gitBranchStatus: null,
    gitWorktreePath: null,
    gitWorktreeStatus: null,
    devServerPort: null,
    devServerPid: null,
    rebaseConflict: null,
    conflictFiles: null,
    processingType: null,
    aiPlatform: null,
    poolCardId: poolCardId,
    poolOrigin: "pulled",
    assignedTo: poolCard.assigned_to || null,
    assignedToName: await (async () => {
      if (!poolCard.assigned_to) return null;
      const { data: member } = await supabase
        .from("team_members")
        .select("display_name")
        .eq("user_id", poolCard.assigned_to)
        .limit(1)
        .single();
      return member?.display_name || null;
    })(),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };

  db.insert(schema.cards).values(newCard).run();

  // Mark pool card as pulled by this user
  await supabase
    .from("pool_cards")
    .update({ pulled_by: user.id })
    .eq("id", poolCardId);

  return NextResponse.json({ cardId: newCard.id, poolCardId }, { status: 201 });
}
