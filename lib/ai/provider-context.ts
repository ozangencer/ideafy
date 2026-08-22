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

/**
 * Short reference string for prompt embedding. Names the files the active
 * provider's CLI auto-loads, so the model knows where to ground task-specific
 * decisions. Cheaper than inlining content; useful when the CLI's auto-load
 * already covers the file.
 */
export function getProviderContextRef(provider: AiPlatform): string {
  switch (provider) {
    case "claude":
      return "@CLAUDE.md (project guidelines) and your auto-memory MEMORY.md (long-term project notes)";
    case "codex":
      return "@AGENTS.md (project guidelines) and ~/.codex/AGENTS.md (your personal instructions)";
    case "gemini":
      return "@GEMINI.md (project guidelines, includes any /memory entries)";
    case "opencode":
      return "@AGENTS.md (project guidelines)";
  }
}

export function getProjectFileLabel(provider: AiPlatform): string {
  switch (provider) {
    case "claude":
      return "CLAUDE.md";
    case "codex":
    case "opencode":
      return "AGENTS.md";
    case "gemini":
      return "GEMINI.md";
  }
}

export function getMemoryFileLabel(provider: AiPlatform): string | null {
  switch (provider) {
    case "claude":
      return "MEMORY.md";
    case "codex":
      return "~/.codex/AGENTS.md";
    case "gemini":
      return "~/.gemini/GEMINI.md";
    case "opencode":
      return "~/.config/opencode/AGENTS.md";
  }
}
