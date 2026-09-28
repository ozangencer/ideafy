import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { createBackup } from "@/lib/backup";
import { ExportData } from "../export/route";
import { SECRET_SETTING_KEYS, isSecretSettingKey } from "@/lib/db/secret-settings";
import { notInArray } from "drizzle-orm";
import { normalizeProjectMode } from "@/lib/project-serialize";

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
      // Before projects: toolkit rows point at them.
      tx.delete(schema.projectToolkitItems).run();
      tx.delete(schema.cards).run();
      tx.delete(schema.cardGroups).run();
      tx.delete(schema.projects).run();
      // After projects: their section_id points here.
      tx.delete(schema.projectSections).run();
      // Keep credential rows: they are excluded from the export by construction,
      // so wiping them here would silently sign the user out of team mode on
      // every restore.
      tx.delete(schema.settings)
        .where(notInArray(schema.settings.key, Array.from(SECRET_SETTING_KEYS)))
        .run();

      // 2. Import sections before projects (projects point at them). Backups
      // written before sections existed have none, so every project lands in
      // "Other".
      const importedSectionIds = new Set<string>();
      for (const section of data.projectSections ?? []) {
        tx.insert(schema.projectSections).values({
          id: section.id,
          name: section.name,
          order: section.order ?? 0,
          collapsed: section.collapsed ?? false,
          createdAt: section.createdAt,
          updatedAt: section.updatedAt,
        }).run();
        importedSectionIds.add(section.id);
      }

      // 3. Import projects (cards depend on projects)
      const importedProjectIds = new Set<string>();
      for (const project of data.projects) {
        importedProjectIds.add(project.id);
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
          mode: normalizeProjectMode(project.mode),
          runMode: project.runMode ?? null,
          runCommand: project.runCommand ?? null,
          previewUrl: project.previewUrl ?? null,
          sharedPaths: project.sharedPaths ?? null,
          sectionId:
            project.sectionId && importedSectionIds.has(project.sectionId)
              ? project.sectionId
              : null,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        }).run();
      }

      // 4. Import card groups (cards reference them by group_id)
      if (data.cardGroups) {
        for (const group of data.cardGroups) {
          tx.insert(schema.cardGroups).values({
            id: group.id,
            projectId: group.projectId ?? null,
            code: group.code,
            name: group.name,
            color: group.color ?? null,
            createdAt: group.createdAt,
          }).run();
        }
      }

      // 5. Import cards
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
          // Backups written before card groups existed simply omit it.
          groupId: card.groupId ?? null,
          // Backups written before manual chain order existed simply omit it.
          groupOrder: card.groupOrder ?? null,
          taskNumber: card.taskNumber,
          gitBranchName: card.gitBranchName ?? null,
          gitBranchStatus: card.gitBranchStatus ?? null,
          gitWorktreePath: card.gitWorktreePath ?? null,
          gitWorktreeStatus: card.gitWorktreeStatus ?? null,
          aiPlatform: card.aiPlatform ?? null,
          useWorktree: card.useWorktree ?? null,
          // Backups written before output paths existed simply omit them.
          outputPaths: card.outputPaths ?? null,
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
          completedAt: card.completedAt,
        }).run();
      }

      // 6. Import settings
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

      // 7. Import toolkit pins. Rows whose project did not come along are
      // skipped rather than failing the foreign key. Older backups carry
      // skillGroups/skillGroupItems instead; those are ignored on purpose.
      for (const item of data.toolkitItems ?? []) {
        if (!importedProjectIds.has(item.projectId)) continue;
        tx.insert(schema.projectToolkitItems).values({
          id: item.id,
          projectId: item.projectId,
          kind: item.kind,
          name: item.name,
          source: item.source ?? null,
          folder: item.folder ?? null,
          order: item.order ?? 0,
          createdAt: item.createdAt,
        }).onConflictDoNothing().run();
      }
    });

    return NextResponse.json({
      success: true,
      imported: {
        cards: data.cards.length,
        projects: data.projects.length,
        projectSections: data.projectSections?.length || 0,
        settings: data.settings?.length || 0,
        cardGroups: data.cardGroups?.length || 0,
        toolkitItems: data.toolkitItems?.length || 0,
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
