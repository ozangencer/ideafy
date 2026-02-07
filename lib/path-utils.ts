import * as path from "path";

/**
 * Safely resolve a relative path within a base directory.
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 * Returns null if the resolved path escapes the base directory.
 */
export function safeResolvePath(baseDir: string, relativePath: string): string | null {
  const normalizedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(baseDir, relativePath);

  if (resolvedPath !== normalizedBase && !resolvedPath.startsWith(normalizedBase + path.sep)) {
    return null;
  }

  return resolvedPath;
}
