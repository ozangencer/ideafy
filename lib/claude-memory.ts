import fs from "fs";
import path from "path";
import os from "os";

/**
 * Resolve the Claude Code auto-memory directory for a given project folder.
 *
 * Claude Code stores per-project memory at:
 *   ~/.claude/projects/<dash-encoded-absolute-path>/memory/
 *
 * The encoding replaces every `/` in the absolute project path with `-`,
 * which means the encoded name starts with `-` (e.g. `/Users/a/b` → `-Users-a-b`).
 */
export function getClaudeMemoryDir(projectFolderPath: string): string {
  const absolute = path.resolve(projectFolderPath);
  const encoded = absolute.replace(/\//g, "-");
  return path.join(os.homedir(), ".claude", "projects", encoded, "memory");
}

export function claudeMemoryDirExists(projectFolderPath: string): boolean {
  const dir = getClaudeMemoryDir(projectFolderPath);
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * True if `filePath` resolves inside any of the provided project folders'
 * Claude memory directories. Used by the document read/write route to allow
 * access to memory files (which sit outside project folders).
 */
export function isInsideClaudeMemory(
  filePath: string,
  projectFolderPaths: string[]
): boolean {
  const resolved = path.resolve(filePath);
  for (const folder of projectFolderPaths) {
    const memoryDir = getClaudeMemoryDir(folder) + path.sep;
    if (resolved.startsWith(memoryDir)) return true;
  }
  return false;
}
