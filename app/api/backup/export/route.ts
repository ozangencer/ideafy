import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { isSecretSettingKey } from "@/lib/db/secret-settings";

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
    groupId: string | null;
    groupOrder?: number | null;
    taskNumber: number | null;
    gitBranchName: string | null;
    gitBranchStatus: string | null;
    gitWorktreePath: string | null;
    gitWorktreeStatus: string | null;
    aiPlatform: string | null;
    useWorktree: boolean | null;
    outputPaths?: string | null; // raw JSON text, as stored
    workTemplateId?: string | null;
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
    voice?: string;
    mode?: string;
    runMode?: string | null;
    runCommand?: string | null;
    previewUrl?: string | null;
    sharedPaths?: string | null;
    sectionId?: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  projectSections?: Array<{
    id: string;
    name: string;
    order: number;
    collapsed: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  settings: Array<{
    key: string;
    value: string;
    updatedAt: string;
  }>;
  cardGroups?: Array<{
    id: string;
    projectId: string | null;
    code: string;
    name: string;
    color: string | null;
    createdAt: string;
  }>;
  toolkitItems?: Array<{
    id: string;
    projectId: string;
    kind: string;
    name: string;
    source: string | null;
    folder?: string | null;
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
    const projectSections = db.select().from(schema.projectSections).all();
    const settings = db.select().from(schema.settings).all();
    const cardGroups = db.select().from(schema.cardGroups).all();
    const toolkitItems = db.select().from(schema.projectToolkitItems).all();

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
        groupId: card.groupId,
        groupOrder: card.groupOrder,
        taskNumber: card.taskNumber,
        gitBranchName: card.gitBranchName,
        gitBranchStatus: card.gitBranchStatus,
        gitWorktreePath: card.gitWorktreePath,
        gitWorktreeStatus: card.gitWorktreeStatus,
        aiPlatform: card.aiPlatform,
        useWorktree: card.useWorktree,
        outputPaths: card.outputPaths,
        workTemplateId: card.workTemplateId,
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
        voice: project.voice,
        mode: project.mode,
        runMode: project.runMode,
        runCommand: project.runCommand,
        previewUrl: project.previewUrl,
        sharedPaths: project.sharedPaths,
        sectionId: project.sectionId,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      })),
      projectSections: projectSections.map((section) => ({
        id: section.id,
        name: section.name,
        order: section.order,
        collapsed: section.collapsed,
        createdAt: section.createdAt,
        updatedAt: section.updatedAt,
      })),
      // Credential-bearing rows are excluded by construction — the export is a
      // shareable artifact and must not carry a live Supabase bearer token.
      settings: settings
        .filter(setting => !isSecretSettingKey(setting.key))
        .map(setting => ({
          key: setting.key,
          value: setting.value,
          updatedAt: setting.updatedAt,
        })),
      cardGroups: cardGroups.map((group) => ({
        id: group.id,
        projectId: group.projectId,
        code: group.code,
        name: group.name,
        color: group.color,
        createdAt: group.createdAt,
      })),
      toolkitItems: toolkitItems.map((item) => ({
        id: item.id,
        projectId: item.projectId,
        kind: item.kind,
        name: item.name,
        source: item.source,
        folder: item.folder,
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
