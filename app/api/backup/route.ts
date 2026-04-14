import { NextResponse } from "next/server";
import { createBackup, getBackupList, cleanOldBackups, getLastBackupTime } from "@/lib/backup";

// GET /api/backup - Get backup list and last backup time.
// Also runs cleanup so stale backups get pruned even when no new one is created.
export async function GET() {
  try {
    cleanOldBackups();

    const backups = getBackupList();
    const lastBackupTime = getLastBackupTime();

    return NextResponse.json({
      backups,
      lastBackupTime,
      count: backups.length,
    });
  } catch (error) {
    console.error("Failed to get backup list:", error);
    return NextResponse.json(
      { error: "Failed to get backup list" },
      { status: 500 }
    );
  }
}

// POST /api/backup - Create a new backup and prune old ones.
export async function POST() {
  try {
    const backup = createBackup();
    const deletedCount = cleanOldBackups();

    return NextResponse.json({
      success: true,
      backup,
      deletedBackups: deletedCount,
    });
  } catch (error) {
    console.error("Failed to create backup:", error);
    return NextResponse.json(
      { error: "Failed to create backup" },
      { status: 500 }
    );
  }
}
