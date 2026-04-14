import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const BACKUP_DIR = path.join(process.cwd(), "backups");
const DB_FILE = "kanban.db";
const RETENTION_DAYS = 7;
const MAX_BACKUP_COUNT = 20;

// Ensure backup directory exists
function ensureBackupDir(): void {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

// Generate daily backup filename — same day always overwrites same file
function generateBackupFilename(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `kanban-${year}-${month}-${day}.db`;
}

// Parse date from backup filename — accepts both legacy and current formats
function parseDateFromFilename(filename: string): Date | null {
  const daily = filename.match(/^kanban-(\d{4})-(\d{2})-(\d{2})\.db$/);
  if (daily) {
    const [, year, month, day] = daily;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }

  const legacy = filename.match(/^kanban-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.db$/);
  if (legacy) {
    const [, year, month, day, hours, minutes] = legacy;
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hours),
      parseInt(minutes)
    );
  }

  return null;
}

export interface BackupInfo {
  filename: string;
  path: string;
  createdAt: string;
  size: number;
}

// Create a backup of the SQLite database
export function createBackup(): BackupInfo {
  ensureBackupDir();

  const sourcePath = path.join(DATA_DIR, DB_FILE);
  const backupFilename = generateBackupFilename();
  const backupPath = path.join(BACKUP_DIR, backupFilename);

  // Copy the database file
  fs.copyFileSync(sourcePath, backupPath);

  const stats = fs.statSync(backupPath);

  return {
    filename: backupFilename,
    path: backupPath,
    createdAt: new Date().toISOString(),
    size: stats.size,
  };
}

// Get list of existing backups
export function getBackupList(): BackupInfo[] {
  ensureBackupDir();

  const files = fs.readdirSync(BACKUP_DIR);
  const backups: BackupInfo[] = [];

  for (const filename of files) {
    if (!filename.endsWith(".db")) continue;
    const date = parseDateFromFilename(filename);
    if (!date) continue;

    const filePath = path.join(BACKUP_DIR, filename);
    const stats = fs.statSync(filePath);

    backups.push({
      filename,
      path: filePath,
      createdAt: date.toISOString(),
      size: stats.size,
    });
  }

  // Sort by date descending (newest first)
  return backups.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

// Clean up backups by age and, if still over the cap, by count.
export function cleanOldBackups(
  retentionDays: number = RETENTION_DAYS,
  maxCount: number = MAX_BACKUP_COUNT
): number {
  ensureBackupDir();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const files = fs.readdirSync(BACKUP_DIR);
  let deletedCount = 0;

  // Pass 1 — age-based cleanup
  for (const filename of files) {
    if (!filename.endsWith(".db")) continue;
    const date = parseDateFromFilename(filename);
    if (!date) continue;

    if (date < cutoffDate) {
      fs.unlinkSync(path.join(BACKUP_DIR, filename));
      deletedCount++;
    }
  }

  // Pass 2 — count cap (oldest first)
  const remaining = getBackupList();
  if (remaining.length > maxCount) {
    const excess = remaining.slice(maxCount);
    for (const backup of excess) {
      fs.unlinkSync(backup.path);
      deletedCount++;
    }
  }

  return deletedCount;
}

// Restore from a specific backup
export function restoreFromBackup(backupFilename: string): boolean {
  // Prevent path traversal — only allow simple filenames
  if (backupFilename.includes("..") || backupFilename.includes(path.sep) || backupFilename.includes("/")) {
    throw new Error(`Invalid backup filename: ${backupFilename}`);
  }

  const backupPath = path.join(BACKUP_DIR, backupFilename);
  const targetPath = path.join(DATA_DIR, DB_FILE);

  // Double-check resolved path is within backup directory
  if (!path.resolve(backupPath).startsWith(path.resolve(BACKUP_DIR))) {
    throw new Error(`Invalid backup path: ${backupFilename}`);
  }

  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupFilename}`);
  }

  // Create a backup of current state before restore
  const preRestoreBackup = `pre-restore-${Date.now()}.db`;
  fs.copyFileSync(targetPath, path.join(BACKUP_DIR, preRestoreBackup));

  // Restore the backup
  fs.copyFileSync(backupPath, targetPath);

  return true;
}

// Get the most recent backup timestamp
export function getLastBackupTime(): string | null {
  const backups = getBackupList();
  if (backups.length === 0) return null;
  return backups[0].createdAt;
}
