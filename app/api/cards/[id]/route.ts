import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { Card } from "@/lib/types";
import { ensureHtml, mergeTestCheckState } from "@/lib/markdown";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const existing = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();

  if (!existing) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  // Validate title if provided - must not be empty
  if (body.title !== undefined) {
    const trimmedTitle = body.title?.trim() || "";
    if (!trimmedTitle) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }
    body.title = trimmedTitle;
  }

  const now = new Date().toISOString();
  const newProjectId = body.projectId !== undefined ? body.projectId : existing.projectId;
  let taskNumber = existing.taskNumber;

  // Handle completedAt timestamp based on status transition
  const oldStatus = existing.status;
  const newStatus = body.status ?? existing.status;
  let completedAt = existing.completedAt;

  if (newStatus === 'completed' && oldStatus !== 'completed') {
    // Moving TO completed: set timestamp
    completedAt = now;
  } else if (newStatus !== 'completed' && oldStatus === 'completed') {
    // Moving FROM completed: clear timestamp
    completedAt = null;
  }

  // If projectId changed and new project is selected, assign new taskNumber
  if (newProjectId !== existing.projectId && newProjectId !== null) {
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, newProjectId))
      .get();

    if (project) {
      // Atomic increment — prevents duplicate task numbers on concurrent requests
      const updated = db.update(schema.projects)
        .set({
          nextTaskNumber: sql`${schema.projects.nextTaskNumber} + 1`,
          updatedAt: now,
        })
        .where(eq(schema.projects.id, newProjectId))
        .returning({ nextTaskNumber: schema.projects.nextTaskNumber })
        .get();
      taskNumber = updated ? updated.nextTaskNumber - 1 : null;
    }
  } else if (newProjectId === null) {
    // If project is removed, clear taskNumber
    taskNumber = null;
  }

  const updatedCard = {
    title: body.title ?? existing.title,
    description: body.description !== undefined ? ensureHtml(body.description) : existing.description,
    solutionSummary: body.solutionSummary !== undefined ? ensureHtml(body.solutionSummary) : existing.solutionSummary,
    testScenarios: body.testScenarios !== undefined
      ? mergeTestCheckState(existing.testScenarios || "", ensureHtml(body.testScenarios))
      : existing.testScenarios,
    aiOpinion: body.aiOpinion !== undefined ? ensureHtml(body.aiOpinion) : existing.aiOpinion,
    aiVerdict: body.aiVerdict !== undefined ? body.aiVerdict : existing.aiVerdict,
    status: body.status ?? existing.status,
    complexity: body.complexity ?? existing.complexity,
    priority: body.priority ?? existing.priority,
    projectFolder: body.projectFolder ?? existing.projectFolder,
    projectId: newProjectId,
    taskNumber,
    aiPlatform: body.aiPlatform !== undefined ? (body.aiPlatform || null) : existing.aiPlatform,
    updatedAt: now,
    completedAt,
  };

  try {
    db.update(schema.cards)
      .set(updatedCard)
      .where(eq(schema.cards.id, id))
      .run();
  } catch (err) {
    console.error("[cards] Failed to update card:", err);
    return NextResponse.json({ error: "Failed to update card" }, { status: 500 });
  }

  const result: Card = {
    id: existing.id,
    title: updatedCard.title,
    description: updatedCard.description,
    solutionSummary: updatedCard.solutionSummary,
    testScenarios: updatedCard.testScenarios,
    aiOpinion: updatedCard.aiOpinion,
    aiVerdict: (updatedCard.aiVerdict as Card["aiVerdict"]) ?? null,
    status: updatedCard.status as Card["status"],
    complexity: updatedCard.complexity as Card["complexity"],
    priority: updatedCard.priority as Card["priority"],
    projectFolder: updatedCard.projectFolder,
    projectId: updatedCard.projectId,
    taskNumber: updatedCard.taskNumber,
    gitBranchName: existing.gitBranchName,
    gitBranchStatus: existing.gitBranchStatus as Card["gitBranchStatus"],
    gitWorktreePath: existing.gitWorktreePath,
    gitWorktreeStatus: existing.gitWorktreeStatus as Card["gitWorktreeStatus"],
    devServerPort: existing.devServerPort,
    devServerPid: existing.devServerPid,
    rebaseConflict: existing.rebaseConflict ?? null,
    conflictFiles: existing.conflictFiles ? JSON.parse(existing.conflictFiles) : null,
    processingType: (existing.processingType as Card["processingType"]) ?? null,
    aiPlatform: (updatedCard.aiPlatform as Card["aiPlatform"]) ?? null,
    createdAt: existing.createdAt,
    updatedAt: updatedCard.updatedAt,
    completedAt: updatedCard.completedAt,
  };

  return NextResponse.json(result);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const existing = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();

  if (!existing) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  db.delete(schema.cards).where(eq(schema.cards.id, id)).run();

  return NextResponse.json({ success: true });
}
