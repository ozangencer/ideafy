import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { Card } from "@/lib/types";
import {
  ensureHtml,
  ensureTestScenariosHtml,
  mergeStaleTestWrite,
  mergeTestCheckState,
} from "@/lib/markdown";

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
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };

  return NextResponse.json(result);
}

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
  const baseUpdatedAt =
    typeof body.baseUpdatedAt === "string" ? body.baseUpdatedAt : null;
  const isStaleWrite = !!(baseUpdatedAt && baseUpdatedAt !== existing.updatedAt);
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

  const nextTestsHtml =
    body.testScenarios !== undefined
      ? ensureTestScenariosHtml(body.testScenarios)
      : existing.testScenarios;

  let resolvedTestScenarios = existing.testScenarios;
  if (body.testScenarios !== undefined) {
    if (isStaleWrite && existing.testScenarios) {
      // Stale client couldn't have seen items added after its read — union-
      // merge so we keep every existing item (even ones missing from the
      // form) while still accepting checkbox toggles the form made on items
      // it did know about.
      resolvedTestScenarios = mergeStaleTestWrite(
        existing.testScenarios,
        nextTestsHtml
      );
    } else {
      resolvedTestScenarios = mergeTestCheckState(
        existing.testScenarios || "",
        nextTestsHtml
      );
    }
  }

  const updatedCard = {
    title: body.title ?? existing.title,
    description: body.description !== undefined ? ensureHtml(body.description) : existing.description,
    solutionSummary: body.solutionSummary !== undefined ? ensureHtml(body.solutionSummary) : existing.solutionSummary,
    testScenarios: resolvedTestScenarios,
    aiOpinion: body.aiOpinion !== undefined ? ensureHtml(body.aiOpinion) : existing.aiOpinion,
    aiVerdict: body.aiVerdict !== undefined ? body.aiVerdict : existing.aiVerdict,
    status: body.status ?? existing.status,
    complexity: body.complexity ?? existing.complexity,
    priority: body.priority ?? existing.priority,
    projectFolder: body.projectFolder ?? existing.projectFolder,
    projectId: newProjectId,
    taskNumber,
    aiPlatform: body.aiPlatform !== undefined ? (body.aiPlatform || null) : existing.aiPlatform,
    useWorktree: body.useWorktree !== undefined
      ? (typeof body.useWorktree === "boolean" ? body.useWorktree : null)
      : existing.useWorktree,
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
    useWorktree: updatedCard.useWorktree ?? null,
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
