import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
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
    projectFolder: "",
    projectId: null,
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
