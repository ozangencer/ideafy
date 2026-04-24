import { COLUMNS, Complexity, Status, AiPlatform } from "@/lib/types";

export const STATUS_COLORS: Record<Status, string> = {
  ideation: "#8b5cf6",
  backlog: "#6b7280",
  bugs: "#ef4444",
  progress: "#facc15",
  test: "#3b82f6",
  completed: "#22c55e",
  withdrawn: "#6b7280",
};

export const STATUS_OPTIONS = COLUMNS.map((c) => ({
  key: c.id as Status,
  label: c.title,
  color: STATUS_COLORS[c.id as Status],
  slash: `/${c.id === "ideation" ? "idea" : c.id === "bugs" ? "bug" : c.id}`,
}));

export const COMPLEXITY_OPTIONS = [
  { key: "low" as Complexity, label: "Low", color: "#22c55e", trigger: "c:low" },
  { key: "medium" as Complexity, label: "Medium", color: "#facc15", trigger: "c:medium" },
  { key: "high" as Complexity, label: "High", color: "#f87171", trigger: "c:high" },
];

export const PLATFORM_LABELS: Record<AiPlatform, { label: string; color: string }> = {
  claude: { label: "Claude", color: "#cc785c" },
  gemini: { label: "Gemini", color: "#4285f4" },
  codex: { label: "Codex", color: "#10a37f" },
  opencode: { label: "OpenCode", color: "#f97316" },
};

export const PLATFORM_OPTIONS = [
  { key: "claude" as AiPlatform, label: "Claude Code", color: "#cc785c", bracket: "[claude" },
  { key: "gemini" as AiPlatform, label: "Gemini CLI", color: "#4285f4", bracket: "[gemini" },
  { key: "codex" as AiPlatform, label: "Codex CLI", color: "#10a37f", bracket: "[codex" },
  { key: "opencode" as AiPlatform, label: "OpenCode", color: "#f97316", bracket: "[opencode" },
];

// Inline `ai:<name>` tokens in the title that immediately set platform (no autocomplete)
export const PLATFORM_INLINE_MAP: Record<string, AiPlatform> = {
  "ai:claude": "claude",
  "ai:gemini": "gemini",
  "ai:codex": "codex",
  "ai:opencode": "opencode",
};

export type StatusOption = (typeof STATUS_OPTIONS)[number];
export type ComplexityOption = (typeof COMPLEXITY_OPTIONS)[number];
export type PlatformOption = (typeof PLATFORM_OPTIONS)[number];
