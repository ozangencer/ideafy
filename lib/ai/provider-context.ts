import fs from "fs/promises";
import path from "path";
import os from "os";
import type { AiPlatform } from "@/lib/types";
import { getClaudeMemoryDir } from "@/lib/claude-memory";

const MAX_FILE_BYTES = 64 * 1024;

export interface ProviderContextFiles {
  projectMd: string | null;
  memoryMd: string | null;
  sources: {
    projectFile: string | null;
    memoryFile: string | null;
  };
}

async function readSafe(p: string | null): Promise<string | null> {
  if (!p) return null;
  try {
    const stat = await fs.stat(p);
    if (!stat.isFile()) return null;
    const size = Math.min(stat.size, MAX_FILE_BYTES);
    const fh = await fs.open(p, "r");
    const buf = Buffer.alloc(size);
    await fh.read(buf, 0, size, 0);
    await fh.close();
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

interface ContextPaths {
  projectFile: string | null;
  memoryFile: string | null;
}

function pathsForProvider(provider: AiPlatform, projectFolderPath: string | null): ContextPaths {
  const home = os.homedir();
  switch (provider) {
    case "claude":
      return {
        projectFile: projectFolderPath ? path.join(projectFolderPath, "CLAUDE.md") : null,
        memoryFile: projectFolderPath
          ? path.join(getClaudeMemoryDir(projectFolderPath), "MEMORY.md")
          : null,
      };
    case "codex":
      return {
        projectFile: projectFolderPath ? path.join(projectFolderPath, "AGENTS.md") : null,
        memoryFile: path.join(home, ".codex", "AGENTS.md"),
      };
    case "gemini":
      return {
        projectFile: projectFolderPath ? path.join(projectFolderPath, "GEMINI.md") : null,
        memoryFile: path.join(home, ".gemini", "GEMINI.md"),
      };
    case "opencode":
      return {
        projectFile: projectFolderPath ? path.join(projectFolderPath, "AGENTS.md") : null,
        memoryFile: path.join(home, ".config", "opencode", "AGENTS.md"),
      };
  }
}

export async function readProviderContext(
  provider: AiPlatform,
  projectFolderPath: string | null
): Promise<ProviderContextFiles> {
  const paths = pathsForProvider(provider, projectFolderPath);
  const [projectMd, memoryMd] = await Promise.all([
    readSafe(paths.projectFile),
    readSafe(paths.memoryFile),
  ]);
  return {
    projectMd,
    memoryMd,
    sources: {
      projectFile: projectMd ? paths.projectFile : null,
      memoryFile: memoryMd ? paths.memoryFile : null,
    },
  };
}

// The pure name lookups live in a sibling module so prompt builders can reach
// them without importing this file's `fs` dependency. Re-exported here so
// existing callers keep their import path.
export {
  getProviderContextRef,
  getProjectFileLabel,
  getMemoryFileLabel,
} from "./provider-context-ref";
