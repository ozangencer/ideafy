import { NextRequest, NextResponse } from "next/server";
import { restoreCard } from "@/lib/card-trash";
import { Card } from "@/lib/types";
import { parseOutputPaths } from "@/lib/output-paths";

// Brings a deleted card back from card_trash — the server half of the board's
// Cmd+Z. 404 when there is no snapshot, 409 when restoring would collide.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const outcome = restoreCard(id);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  const row = outcome.card;
  const result: Card = {
    id: row.id,
    title: row.title,
    description: row.description,
    solutionSummary: row.solutionSummary,
    testScenarios: row.testScenarios,
    aiOpinion: row.aiOpinion,
    aiVerdict: (row.aiVerdict as Card["aiVerdict"]) ?? null,
    status: row.status as Card["status"],
    complexity: row.complexity as Card["complexity"],
    priority: row.priority as Card["priority"],
    projectFolder: row.projectFolder,
    projectId: row.projectId,
    groupId: row.groupId,
    groupOrder: row.groupOrder ?? null,
    taskNumber: row.taskNumber,
    gitBranchName: row.gitBranchName,
    gitBranchStatus: row.gitBranchStatus as Card["gitBranchStatus"],
    gitWorktreePath: row.gitWorktreePath,
    gitWorktreeStatus: row.gitWorktreeStatus as Card["gitWorktreeStatus"],
    devServerPort: row.devServerPort,
    devServerPid: row.devServerPid,
    rebaseConflict: row.rebaseConflict ?? null,
    conflictFiles: row.conflictFiles ? JSON.parse(row.conflictFiles) : null,
    processingType: (row.processingType as Card["processingType"]) ?? null,
    aiPlatform: (row.aiPlatform as Card["aiPlatform"]) ?? null,
    useWorktree: row.useWorktree ?? null,
    outputPaths: parseOutputPaths(row.outputPaths),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };

  return NextResponse.json(result);
}
