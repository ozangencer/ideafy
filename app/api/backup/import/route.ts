import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { createBackup } from "@/lib/backup";
import { ExportData } from "../export/route";
import { SECRET_SETTING_KEYS, isSecretSettingKey } from "@/lib/db/secret-settings";
import { notInArray } from "drizzle-orm";

// POST /api/backup/import - Import data from JSON
export async function POST(request: NextRequest) {
  try {
    const data: ExportData = await request.json();

    // Validate the import data
    if (!data.version || !data.cards || !data.projects) {
      return NextResponse.json(
        { error: "Invalid import file format" },
        { status: 400 }
      );
    }

    // Create a backup before import
    const preImportBackup = createBackup();

    // Wrap entire import in a transaction for atomicity
    db.transaction((tx) => {
      // 1. Delete all existing data
      tx.delete(schema.skillGroupItems).run();
      tx.delete(schema.skillGroups).run();
      tx.delete(schema.cards).run();
      tx.delete(schema.projects).run();
      // Keep credential rows: they are excluded from the export by construction,
      // so wiping them here would silently sign the user out of team mode on
      // every restore.
      tx.delete(schema.settings)
        .where(notInArray(schema.settings.key, Array.from(SECRET_SETTING_KEYS)))
        .run();

      // 2. Import projects first (cards depend on projects)
      for (const project of data.projects) {
        tx.insert(schema.projects).values({
          id: project.id,
          name: project.name,
          folderPath: project.folderPath,
          idPrefix: project.idPrefix,
          nextTaskNumber: project.nextTaskNumber,
          color: project.color,
          isPinned: project.isPinned,
          documentPaths: project.documentPaths,
          narrativePath: project.narrativePath ?? null,
          useWorktrees: project.useWorktrees ?? true,
          // Backups written before these columns existed simply omit them —
          // the defaults mean "detect", which is what an old project wants.
          ...(project.voice ? { voice: project.voice } : {}),
          runMode: project.runMode ?? null,
          runCommand: project.runCommand ?? null,
          previewUrl: project.previewUrl ?? null,
          sharedPaths: project.sharedPaths ?? null,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        }).run();
      }

      // 3. Import cards
      for (const card of data.cards) {
        tx.insert(schema.cards).values({
          id: card.id,
          title: card.title,
          description: card.description,
          solutionSummary: card.solutionSummary,
          testScenarios: card.testScenarios,
          aiOpinion: card.aiOpinion,
          aiVerdict: card.aiVerdict ?? null,
          status: card.status,
          complexity: card.complexity,
          priority: card.priority,
          projectFolder: card.projectFolder,
          projectId: card.projectId,
          taskNumber: card.taskNumber,
          gitBranchName: card.gitBranchName ?? null,
          gitBranchStatus: card.gitBranchStatus ?? null,
          gitWorktreePath: card.gitWorktreePath ?? null,
          gitWorktreeStatus: card.gitWorktreeStatus ?? null,
          aiPlatform: card.aiPlatform ?? null,
          useWorktree: card.useWorktree ?? null,
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
          completedAt: card.completedAt,
        }).run();
      }

      // 4. Import settings
      if (data.settings) {
        for (const setting of data.settings) {
          // The backup file is untrusted input. Never let it plant a bearer
          // token — that would be session fixation via a shared backup.
          if (isSecretSettingKey(setting.key)) continue;
          tx.insert(schema.settings).values({
            key: setting.key,
            value: setting.value,
            updatedAt: setting.updatedAt,
          }).run();
        }
      }

      // 5. Import skill groups
      if (data.skillGroups) {
        for (const group of data.skillGroups) {
          tx.insert(schema.skillGroups).values({
            id: group.id,
            name: group.name,
            scope: group.scope,
            projectId: group.projectId,
            order: group.order,
            createdAt: group.createdAt,
            updatedAt: group.updatedAt,
          }).run();
        }
      }

      // 6. Import skill group items
      if (data.skillGroupItems) {
        for (const item of data.skillGroupItems) {
          tx.insert(schema.skillGroupItems).values({
            id: item.id,
            groupId: item.groupId,
            skillName: item.skillName,
            order: item.order,
            createdAt: item.createdAt,
          }).run();
        }
      }
    });

    return NextResponse.json({
      success: true,
      imported: {
        cards: data.cards.length,
        projects: data.projects.length,
        settings: data.settings?.length || 0,
        skillGroups: data.skillGroups?.length || 0,
        skillGroupItems: data.skillGroupItems?.length || 0,
      },
      preImportBackup: preImportBackup.filename,
    });
  } catch (error) {
    console.error("Failed to import data:", error);
    return NextResponse.json(
      { error: "Failed to import data" },
      { status: 500 }
    );
  }
}
