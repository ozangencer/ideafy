import type { AiPlatform } from "../types";

export interface PlatformCapabilities {
  supportsAutonomousMode: boolean;
  supportsStreamJson: boolean;
  supportsPermissionModes: boolean;
  supportsHooks: boolean;
  supportsSkills: boolean;
  supportsMcp: boolean;
  supportsAgents: boolean;
  supportsSessionResume: boolean;
  mcpConfigFormat: "json" | "toml";
}

export interface AutonomousOptions {
  prompt: string;
}

export interface InteractiveOptions {
  prompt: string;
  cardId: string;
  permissionMode?: "plan" | null;
}

export interface InteractiveInvocation {
  cwd: string;
  argv: string[];
  env?: Record<string, string>;
}

export interface StreamOptions {
  prompt: string;
  allowedTools?: string[];
  skipPermissions?: boolean;
  addDirs?: string[];
  resumeSessionId?: string;
  newSessionId?: string;
}

export interface CliResponse {
  result: string;
  cost?: number;
  duration?: number;
  isError: boolean;
}

export interface StreamEvent {
  // `text` is an additive delta (Claude/Codex). `text_replace` carries an
  // accumulated snapshot (Gemini emits the full message-so-far on every
  // chunk) and the consumer must overwrite, not append, to avoid quadratic
  // duplication when chunks pile up.
  type: "text" | "text_replace" | "thinking" | "tool_use" | "tool_result" | "result" | "system" | "session_id";
  data: unknown;
}

export type Result = { success: boolean; error?: string };

export interface PlatformProvider {
  id: AiPlatform;
  displayName: string;
  installCommand: string;
  capabilities: PlatformCapabilities;

  // CLI resolution
  getCliPath(): string;
  getEnv(): NodeJS.ProcessEnv;
  getCIEnv(): NodeJS.ProcessEnv;

  // Command building
  buildAutonomousArgs(opts: AutonomousOptions): string[];
  buildInteractiveCommand(opts: InteractiveOptions, workingDir: string): InteractiveInvocation;
  buildStreamArgs(opts: StreamOptions): string[];

  // Response parsing
  parseJsonResponse(stdout: string): CliResponse;
  parseStreamLine(line: string): StreamEvent[];

  // Config paths
  getDefaultSkillsPath(): string;
  getDefaultMcpConfigPath(): string;
  getDefaultAgentsPath(): string;
  getProjectConfigDir(): string;

  // Extensions
  listProjectMcps(folderPath: string): string[];
  listProjectSkills(folderPath: string): string[];
  listProjectAgents(folderPath: string): string[];
  installIdeafyMcp(folderPath: string): Result;
  removeIdeafyMcp(folderPath: string): Result;
  hasIdeafyMcp(folderPath: string): boolean;
  installIdeafySkills(folderPath: string): Result;
  removeIdeafySkills(folderPath: string): Result;
  hasIdeafySkills(folderPath: string): boolean;

  // Hooks (only Claude supports this)
  installIdeafyHook?(folderPath: string): Result;
  removeIdeafyHook?(folderPath: string): Result;
}
