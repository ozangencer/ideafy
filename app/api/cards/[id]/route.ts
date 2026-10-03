import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { Card } from "@/lib/types";
import { trashCard } from "@/lib/card-trash";
import { QUEUE_CLEARING_STATUSES } from "@/lib/card-queue";
import { parseOutputPaths } from "@/lib/output-paths";
import { completedAtFor } from "@/lib/card-ops";
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
    groupId: row.groupId,
    groupOrder: row.groupOrder ?? null,
    queuePosition: row.queuePosition ?? null,
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
    workTemplateId: row.workTemplateId ?? null,
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

  // The same completed_at rule the MCP's move_card and update_card apply.
  let completedAt = completedAtFor(
    existing.status,
    body.status ?? existing.status,
    existing.completedAt,
    now
  );

  // Undo sends the timestamp it is rolling back to, so a card pulled out of
  // Completed and put back keeps the day it was actually finished.
  if (body.completedAt !== undefined) {
    completedAt = typeof body.completedAt === "string" ? body.completedAt : null;
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
    // `null` is a meaningful value here (leave the group), so an explicit
    // undefined check is the only way to tell "clear it" from "don't touch it".
    groupId: body.groupId !== undefined ? (body.groupId || null) : existing.groupId,
    taskNumber,
    aiPlatform: body.aiPlatform !== undefined ? (body.aiPlatform || null) : existing.aiPlatform,
    useWorktree: body.useWorktree !== undefined
      ? (typeof body.useWorktree === "boolean" ? body.useWorktree : null)
      : existing.useWorktree,
    workTemplateId: body.workTemplateId !== undefined
      ? (typeof body.workTemplateId === "string" && body.workTemplateId ? body.workTemplateId : null)
      : existing.workTemplateId,
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
    groupId: updatedCard.groupId,
    // The response is built from the body, not re-read, so mirror what the
    // group_id trigger just did — otherwise the store writes the cleared
    // position straight back onto a card that moved groups.
    groupOrder: updatedCard.groupId !== existing.groupId ? null : existing.groupOrder ?? null,
    // Same for the status trigger: a queued card moved to Human Test by hand
    // leaves the queue in the DB, and must leave it in the store too. Only on
    // a real move — a save that writes "test" back onto a Human Test card
    // keeps it queued for pre-verify, in the DB and here alike.
    queuePosition:
      updatedCard.status !== existing.status &&
      QUEUE_CLEARING_STATUSES.has(updatedCard.status as Card["status"])
        ? null
        : existing.queuePosition ?? null,
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
    outputPaths: parseOutputPaths(existing.outputPaths),
    workTemplateId: updatedCard.workTemplateId ?? null,
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

  // The card goes into card_trash on its way out so the board can undo the
  // delete (Cmd+Z); see lib/card-trash.ts.
  if (!trashCard(id)) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
