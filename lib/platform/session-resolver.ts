/**
 * Resolves CLI session IDs for providers that don't support pre-set session IDs.
 * Claude uses --session-id to control the ID upfront; Codex and Gemini auto-generate them.
 */

import { readdirSync, statSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

/**
 * Find the most recently modified session file in a directory.
 * Returns the filename (without extension) as the session ID, or null.
 */
function findLatestSessionIn(dir: string, ext: string): string | null {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(ext));
    if (files.length === 0) return null;

    let latest: { name: string; mtime: number } | null = null;
    for (const file of files) {
      const stat = statSync(join(dir, file));
      if (!latest || stat.mtimeMs > latest.mtime) {
        latest = { name: file, mtime: stat.mtimeMs };
      }
    }
    return latest ? latest.name.replace(ext, "") : null;
  } catch {
    return null;
  }
}

/**
 * Resolve session ID after a fresh CLI spawn.
 * Called only for providers that auto-generate session IDs (Codex, Gemini).
 */
export function resolveSessionId(provider: string, cwd: string): string | null {
  const home = process.env.HOME || process.env.USERPROFILE || "";

  if (provider === "codex") {
    return findLatestSessionIn(join(home, ".codex", "sessions"), ".jsonl");
  }

  if (provider === "gemini") {
    // Gemini uses a hash of the project path for directory naming
    const projectHash = createHash("md5").update(cwd).digest("hex").slice(0, 8);
    const chatsDir = join(home, ".gemini", "tmp", projectHash, "chats");
    return findLatestSessionIn(chatsDir, ".json");
  }

  return null;
}
