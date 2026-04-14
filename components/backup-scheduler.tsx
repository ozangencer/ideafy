"use client";

import { useEffect, useRef } from "react";

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function BackupScheduler() {
  const lastBackupRef = useRef<number>(0);

  useEffect(() => {
    // Function to trigger backup
    const triggerBackup = async () => {
      try {
        const response = await fetch("/api/backup", { method: "POST" });
        if (response.ok) {
          const data = await response.json();
          console.log(
            `[Backup] Created: ${data.backup.filename}, Cleaned: ${data.deletedBackups} old backups`
          );
          lastBackupRef.current = Date.now();
        } else {
          console.error("[Backup] Failed to create backup");
        }
      } catch (error) {
        console.error("[Backup] Error:", error);
      }
    };

    // Create initial backup on mount
    triggerBackup();

    // Set up hourly interval
    const intervalId = setInterval(() => {
      triggerBackup();
    }, BACKUP_INTERVAL_MS);

    // Cleanup on unmount
    return () => {
      clearInterval(intervalId);
    };
  }, []);

  // This component doesn't render anything visible
  return null;
}
