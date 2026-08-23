import type { AiPlatform } from "@/lib/types";

/**
 * Provider-specific file names, kept apart from the reader above them: these
 * are pure string lookups, and prompts that need them must not have to drag
 * `fs` into whatever bundle imports them.
 */

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
