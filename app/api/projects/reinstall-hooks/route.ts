import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { getActiveProvider } from "@/lib/platform/active";

export async function POST() {
  try {
    const provider = getActiveProvider();

    // Check if the active platform supports hooks
    if (!provider.installKanbanHook) {
      return NextResponse.json({
        message: `${provider.displayName} does not support hooks`,
        results: [],
      });
    }

    const projects = db.select().from(schema.projects).all();

    const results: { projectId: string; name: string; success: boolean; error?: string }[] = [];

    for (const project of projects) {
      if (project.folderPath) {
        const hookResult = provider.installKanbanHook(project.folderPath);
        results.push({
          projectId: project.id,
          name: project.name,
          success: hookResult.success,
          error: hookResult.error,
        });
      } else {
        results.push({
          projectId: project.id,
          name: project.name,
          success: false,
          error: "No folder path",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return NextResponse.json({
      message: `Hooks installed: ${successCount} success, ${failCount} failed`,
      results,
    });
  } catch (error) {
    console.error("Failed to reinstall hooks:", error);
    return NextResponse.json(
      { error: "Failed to reinstall hooks" },
      { status: 500 }
    );
  }
}
