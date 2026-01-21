import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { eq, desc, isNotNull, and, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { Card } from "@/lib/types";
import { ensureHtml } from "@/lib/markdown";

// Processing timeout in milliseconds (30 minutes)
const PROCESSING_TIMEOUT_MS = 30 * 60 * 1000;

export async function GET() {
  // Auto-cleanup stuck processing states (older than 30 minutes)
  const timeoutThreshold = new Date(Date.now() - PROCESSING_TIMEOUT_MS).toISOString();

  db.update(schema.cards)
    .set({ processingType: null })
    .where(
      and(
        isNotNull(schema.cards.processingType),
        lt(schema.cards.updatedAt, timeoutThreshold)
      )
    )
    .run();

  const rows = db.select().from(schema.cards).orderBy(desc(schema.cards.taskNumber)).all();

  const cards: Card[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    solutionSummary: row.solutionSummary,
    testScenarios: row.testScenarios,
    aiOpinion: row.aiOpinion,
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  }));

  return NextResponse.json(cards);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const now = new Date().toISOString();

  // Validate title is required and not empty
  const title = body.title?.trim() || "";
  if (!title) {
    return NextResponse.json(
      { error: "Title is required" },
      { status: 400 }
    );
  }

  let taskNumber: number | null = null;
  let projectFolder = body.projectFolder || "";

  // If projectId provided, get next task number
  if (body.projectId) {
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, body.projectId))
      .get();

    if (project) {
      taskNumber = project.nextTaskNumber;
      projectFolder = project.folderPath;

      // Increment project's nextTaskNumber
      db.update(schema.projects)
        .set({
          nextTaskNumber: project.nextTaskNumber + 1,
          updatedAt: now,
        })
        .where(eq(schema.projects.id, body.projectId))
        .run();
    }
  }

  const newCard = {
    id: uuidv4(),
    title,
    description: ensureHtml(body.description || ""),
    solutionSummary: ensureHtml(body.solutionSummary || ""),
    testScenarios: ensureHtml(body.testScenarios || ""),
    aiOpinion: ensureHtml(body.aiOpinion || ""),
    status: body.status || "backlog",
    complexity: body.complexity || "medium",
    priority: body.priority || "medium",
    projectFolder,
    projectId: body.projectId || null,
    taskNumber,
    gitBranchName: null,
    gitBranchStatus: null,
    gitWorktreePath: null,
    gitWorktreeStatus: null,
    devServerPort: null,
    devServerPid: null,
    rebaseConflict: null,
    conflictFiles: null,
    processingType: null,
    createdAt: now,
    updatedAt: now,
    completedAt: (body.status === 'completed') ? now : null,
  };

  db.insert(schema.cards).values(newCard).run();

  return NextResponse.json(newCard, { status: 201 });
}
