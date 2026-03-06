import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import { db, schema } from "@/lib/db";

function getSupabaseServer(authHeader: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  return createClient(url, anonKey, {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
}

// POST: Pull a pool card into local SQLite
export async function POST(request: NextRequest) {
  const supabase = getSupabaseServer(request.headers.get("Authorization"));
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { poolCardId } = body;

  if (!poolCardId) {
    return NextResponse.json({ error: "poolCardId is required" }, { status: 400 });
  }

  // Read pool card from Supabase
  const { data: poolCard, error: poolError } = await supabase
    .from("pool_cards")
    .select("*")
    .eq("id", poolCardId)
    .single();

  if (poolError || !poolCard) {
    return NextResponse.json({ error: "Pool card not found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  // Create local SQLite card from pool card data
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

  return NextResponse.json({ cardId: newCard.id, poolCardId }, { status: 201 });
}
