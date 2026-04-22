import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";

export interface ExportData {
  version: string;
  exportedAt: string;
  cards: Array<{
    id: string;
    title: string;
    description: string;
    solutionSummary: string;
    testScenarios: string;
    aiOpinion: string;
    aiVerdict: string | null;
    status: string;
    complexity: string;
    priority: string;
    projectFolder: string;
    projectId: string | null;
    taskNumber: number | null;
    gitBranchName: string | null;
    gitBranchStatus: string | null;
    gitWorktreePath: string | null;
    gitWorktreeStatus: string | null;
    aiPlatform: string | null;
    useWorktree: boolean | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
  }>;
  projects: Array<{
    id: string;
    name: string;
    folderPath: string;
    idPrefix: string;
    nextTaskNumber: number;
    color: string;
    isPinned: boolean;
    documentPaths: string | null;
    narrativePath: string | null;
    useWorktrees: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  settings: Array<{
    key: string;
    value: string;
    updatedAt: string;
  }>;
  skillGroups?: Array<{
    id: string;
    name: string;
    scope: string;
    projectId: string | null;
    order: number;
    createdAt: string;
    updatedAt: string;
  }>;
  skillGroupItems?: Array<{
    id: string;
    groupId: string;
    skillName: string;
    order: number;
    createdAt: string;
  }>;
}

// GET /api/backup/export - Export all data as JSON
export async function GET() {
  try {
    // Fetch all data
    const cards = db.select().from(schema.cards).all();
    const projects = db.select().from(schema.projects).all();
    const settings = db.select().from(schema.settings).all();
    const skillGroups = db.select().from(schema.skillGroups).all();
    const skillGroupItems = db.select().from(schema.skillGroupItems).all();

    const exportData: ExportData = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      cards: cards.map(card => ({
        id: card.id,
        title: card.title,
        description: card.description,
        solutionSummary: card.solutionSummary,
        testScenarios: card.testScenarios,
        aiOpinion: card.aiOpinion,
        aiVerdict: card.aiVerdict,
        status: card.status,
        complexity: card.complexity,
        priority: card.priority,
        projectFolder: card.projectFolder,
        projectId: card.projectId,
        taskNumber: card.taskNumber,
        gitBranchName: card.gitBranchName,
        gitBranchStatus: card.gitBranchStatus,
        gitWorktreePath: card.gitWorktreePath,
        gitWorktreeStatus: card.gitWorktreeStatus,
        aiPlatform: card.aiPlatform,
        useWorktree: card.useWorktree,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
        completedAt: card.completedAt,
      })),
      projects: projects.map(project => ({
        id: project.id,
        name: project.name,
        folderPath: project.folderPath,
        idPrefix: project.idPrefix,
        nextTaskNumber: project.nextTaskNumber,
        color: project.color,
        isPinned: project.isPinned,
        documentPaths: project.documentPaths,
        narrativePath: project.narrativePath,
        useWorktrees: project.useWorktrees,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      })),
      settings: settings.map(setting => ({
        key: setting.key,
        value: setting.value,
        updatedAt: setting.updatedAt,
      })),
      skillGroups: skillGroups.map((group) => ({
        id: group.id,
        name: group.name,
        scope: group.scope,
        projectId: group.projectId,
        order: group.order,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      })),
      skillGroupItems: skillGroupItems.map((item) => ({
        id: item.id,
        groupId: item.groupId,
        skillName: item.skillName,
        order: item.order,
        createdAt: item.createdAt,
      })),
    };

    // Generate filename with timestamp
    const now = new Date();
    const filename = `ideafy-export-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.json`;

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Failed to export data:", error);
    return NextResponse.json(
      { error: "Failed to export data" },
      { status: 500 }
    );
  }
}
