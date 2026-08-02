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

/**
 * One contiguous stretch of assistant prose from a headless run — a "text run":
 * every consecutive `text` block with no `tool_use` block and no user message
 * in between. `thinking` blocks don't break it.
 *
 * This, not "a turn", is the unit a run's actual product lives in. The CLI
 * emits one assistant envelope *per content block*, so a single model turn that
 * narrates and then calls a tool already spans two envelopes; and a run that
 * writes its answer, runs one last `git status`, then says "Done." produces two
 * text runs where a turn-based split would produce one.
 */
export interface RunOutputCandidate {
  text: string;
  /** 0 for the original prompt's invocation; +1 per injected re-invocation. */
  segment: number;
  followedByToolUse: boolean;
}

/**
 * A headless run decomposed into everything needed to pick its product, rather
 * than collapsed to the CLI's `result` field (which is only ever the *last*
 * thing said — see IDE-280).
 */
export interface ParsedRunOutput {
  candidates: RunOutputCandidate[];
  /** The CLI's own `result` field. Used for the error path and as a fallback. */
  result: string;
  cost?: number;
  duration?: number;
  isError: boolean;
  /**
   * Whether a terminating `result` envelope arrived. Under stream-json stdout is
   * never empty (a `system/init` line lands immediately), so this — not
   * "stdout is blank" — is what tells a crash apart from a clean finish.
   */
  sawResultEnvelope: boolean;
  /** Re-invocations injected by the harness (task notifications, compaction). */
  injectedUserMessages: number;
}

/**
 * Incremental parser for a headless run's stdout. Fed chunk by chunk so the
 * caller never holds the whole stream: tool results carry file contents and
 * hook events embed hook stdout, none of which is retained.
 */
export interface RunOutputCollector {
  push(chunk: string): void;
  finish(): ParsedRunOutput;
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
  /**
   * Optional. Providers whose `buildAutonomousArgs` emits a parseable event
   * stream implement this to expose the run's individual text runs. Callers
   * fall back to the buffered `parseJsonResponse` path when it's absent, so a
   * provider that doesn't implement it behaves exactly as it always has.
   */
  createRunOutputCollector?(): RunOutputCollector;

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
