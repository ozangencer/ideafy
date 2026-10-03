import * as fs from "fs";
import * as path from "path";
import { join } from "path";
import type {
  PlatformProvider,
  PlatformCapabilities,
  AutonomousOptions,
  InteractiveOptions,
  InteractiveInvocation,
  StreamOptions,
  CliResponse,
  StreamEvent,
  RunOutputCollector,
  Result,
  OneShotRunKind,
} from "./types";
import { findBinary, buildEnv, buildCIEnv } from "./base-provider";
import { appResourcesRoot, resolveUserSkillsDir } from "../paths";
import { parseClaudeStreamLine } from "./claude-provider/parse-stream-line";
import { createClaudeRunOutputCollector } from "./claude-provider/collect-run-output";
import { buildMcpInvocation } from "./mcp-invocation";
import { IDEAFY_MCP_SERVER } from "./mcp-tool-names";

/** Tools an autonomous `claude -p` run cannot use to any effect; see buildAutonomousArgs. */
export const AUTONOMOUS_DISALLOWED_TOOLS = [
  "Monitor",
  "ScheduleWakeup",
  "CronCreate",
  "RemoteTrigger",
  "AskUserQuestion",
] as const;

/**
 * Model and effort a one-shot run pins, so a global "frontier model + xhigh"
 * setting doesn't turn a one-minute Evaluate into four (IDE-361). Aliases, not
 * full ids, so the table doesn't go stale with every model release.
 */
const ONE_SHOT_RUN_PROFILES: Record<OneShotRunKind, { model: string; effort: string }> = {
  evaluate: { model: "opus", effort: "medium" },
  "quick-fix": { model: "opus", effort: "medium" },
};

/**
 * Evaluate only needs the Ideafy MCP. `--setting-sources user` otherwise spawns
 * every user-scope server (firecrawl, chrome-devtools, …), which slows init and
 * hands the model tools it wanders off with. Quick Fix and phase runs keep them:
 * their verification step can genuinely need chrome-devtools.
 *
 * Connecting the app's own server directly also sidesteps the plugin copy, and
 * names its tools `mcp__ideafy__*` exactly as the prompts spell them.
 */
function strictIdeafyMcpArgs(): string[] {
  try {
    const config = { mcpServers: { [IDEAFY_MCP_SERVER]: buildMcpInvocation() } };
    return ["--strict-mcp-config", "--mcp-config", JSON.stringify(config)];
  } catch (error) {
    // Packaged build missing its MCP env vars: run with the user's servers as
    // before rather than fail the evaluation.
    console.warn("[Claude] Strict MCP config unavailable, falling back to user servers:", error);
    return [];
  }
}
import {
  listProjectMcps as listProjectMcpsImpl,
  listProjectSkills as listProjectSkillsImpl,
  listProjectAgents as listProjectAgentsImpl,
} from "./claude-provider/list-project-resources";
import {
  installIdeafyMcp as installIdeafyMcpImpl,
  removeIdeafyMcp as removeIdeafyMcpImpl,
  hasIdeafyMcp as hasIdeafyMcpImpl,
} from "./claude-provider/ideafy-mcp";

// In dev IDEAFY_ROOT is the repo (skills/ + mcp-server/index.ts live there);
// in the packaged DMG the Electron shell exports IDEAFY_APP_RESOURCES pointing
// at Resources/app.asar. Either way appResourcesRoot() returns the right
// anchor for read-only bundled files.
const IDEAFY_ROOT = appResourcesRoot();
const MCP_SERVER_PATH = path.join(IDEAFY_ROOT, "mcp-server", "index.ts");
// Skills are read from the user-writable mirror so custom/user-edited
// skills take precedence over the bundled copies.
const SKILLS_DIR = resolveUserSkillsDir();
const SKILL_FILES = ["human-test.md", "product-narrative.md", "ideafy.md"];

function readSkill(name: string): string {
  return fs.readFileSync(path.join(SKILLS_DIR, `${name}.md`), "utf-8");
}

function parseSkillVersion(content: string): string | null {
  const match = content.match(/^---[\s\S]*?version:\s*"([^"]+)"[\s\S]*?---/);
  return match ? match[1] : null;
}

function shouldUpdateSkill(bundledContent: string, installedPath: string): boolean {
  if (!fs.existsSync(installedPath)) return true;
  const installed = fs.readFileSync(installedPath, "utf-8");
  const bundledVersion = parseSkillVersion(bundledContent);
  const installedVersion = parseSkillVersion(installed);
  if (!bundledVersion) return false;
  if (!installedVersion) return true;
  return bundledVersion !== installedVersion;
}

// Cache the CLI path
let cachedClaudePath: string | null = null;

class ClaudeProvider implements PlatformProvider {
  id = "claude" as const;
  displayName = "Claude Code";
  installCommand = "npm install -g @anthropic-ai/claude-code";

  capabilities: PlatformCapabilities = {
    supportsAutonomousMode: true,
    supportsStreamJson: true,
    supportsPermissionModes: true,
    supportsHooks: true,
    supportsSkills: true,
    supportsMcp: true,
    supportsAgents: true,
    supportsSessionResume: true,
    mcpConfigFormat: "json",
  };

  getCliPath(): string {
    if (cachedClaudePath) return cachedClaudePath;

    const home = process.env.HOME || process.env.USERPROFILE || "";
    const candidates = [
      join(home, ".local", "bin", "claude"),
      join(home, ".claude", "bin", "claude"),
      "/usr/local/bin/claude",
      "/usr/bin/claude",
      "/opt/homebrew/bin/claude",
    ];

    cachedClaudePath = findBinary("claude", candidates);
    return cachedClaudePath;
  }

  getEnv(): NodeJS.ProcessEnv {
    return buildEnv();
  }

  getCIEnv(): NodeJS.ProcessEnv {
    return buildCIEnv();
  }

  buildAutonomousArgs(opts: AutonomousOptions): string[] {
    const args = [
      "-p", opts.prompt,
      "--dangerously-skip-permissions",
      // stream-json rather than json: the latter collapses the whole run to its
      // `result` field, which is only ever the *last* thing the model said. A
      // background command finishing mid-run re-invokes the model, and the real
      // output is lost behind the follow-up remark (IDE-280). The event stream
      // keeps every text run so the caller can pick the right one.
      "--output-format", "stream-json",
      "--verbose",
      // Deliberately no --include-partial-messages: nothing consumes deltas
      // here, and the consolidated blocks give cleaner run boundaries.
      "--setting-sources", "user",
      // A headless run exits the moment its last message is written, so a tool
      // that waits to be woken up — or asks a user who isn't there — strands
      // the run mid-task (IDE-319). `run_in_background` is a Bash parameter
      // and can't be denied by name; the one-shot prompt rule and the
      // collector's wait detection cover it.
      "--disallowedTools", AUTONOMOUS_DISALLOWED_TOOLS.join(","),
    ];
    if (opts.runKind) {
      const { model, effort } = ONE_SHOT_RUN_PROFILES[opts.runKind];
      args.push("--model", model, "--effort", effort);
    }
    if (opts.runKind === "evaluate") {
      args.push(...strictIdeafyMcpArgs());
    }
    return args;
  }

  buildInteractiveCommand(opts: InteractiveOptions, workingDir: string): InteractiveInvocation {
    const cleanPrompt = opts.prompt.replace(/\n/g, " ");
    const argv = [this.getCliPath(), cleanPrompt];
    if (opts.permissionMode) {
      argv.push("--permission-mode", opts.permissionMode);
    }
    return {
      cwd: workingDir,
      argv,
      env: { IDEAFY_CARD_ID: opts.cardId },
    };
  }

  buildStreamArgs(opts: StreamOptions): string[] {
    const args = [
      "-p", opts.prompt,
      "--print",
      "--output-format", "stream-json",
      "--verbose",
      // Stream content_block_delta chunks as they arrive so the UI sees
      // text/thinking flow live instead of arriving as one consolidated
      // assistant message at the end.
      "--include-partial-messages",
    ];

    if (opts.skipPermissions) {
      args.push("--dangerously-skip-permissions");
    }
    // A chat turn is a `-p` too: whatever it leaves waiting in the background
    // is stopped when the turn ends (IDE-392), so the wait tools go on every
    // turn, resumed ones included.
    args.push("--disallowedTools", AUTONOMOUS_DISALLOWED_TOOLS.join(","));

    if (opts.resumeSessionId) {
      args.push("--resume", opts.resumeSessionId);
    } else if (opts.newSessionId) {
      args.push("--session-id", opts.newSessionId);
    }
    // A resumed session does not inherit the allow-list from the spawn that
    // created it: every `-p` invocation is its own process with its own
    // flags, so leaving this inside the fresh branch meant the second message
    // in a chat had no MCP permissions at all.
    if (!opts.skipPermissions && opts.allowedTools?.length) {
      args.push("--allowedTools", ...opts.allowedTools);
    }

    if (opts.addDirs?.length) {
      for (const dir of opts.addDirs) {
        args.push("--add-dir", dir);
      }
    }
    return args;
  }

  parseJsonResponse(stdout: string): CliResponse {
    try {
      const response = JSON.parse(stdout);
      return {
        result: response.result || "",
        // The CLI emits `total_cost_usd`; `cost_usd` has never existed, so this
        // silently returned undefined until IDE-280.
        cost: response.total_cost_usd ?? response.cost_usd,
        duration: response.duration_ms,
        isError: !!response.is_error,
      };
    } catch {
      return { result: stdout.trim(), isError: false };
    }
  }

  parseStreamLine(line: string): StreamEvent[] {
    return parseClaudeStreamLine(line);
  }

  createRunOutputCollector(): RunOutputCollector {
    return createClaudeRunOutputCollector();
  }

  getDefaultSkillsPath(): string {
    return "~/.claude/skills";
  }

  getDefaultMcpConfigPath(): string {
    return "~/.claude.json";
  }

  getDefaultAgentsPath(): string {
    return "~/.claude/agents";
  }

  getProjectConfigDir(): string {
    return ".claude";
  }

  // ── Extension methods ──

  listProjectMcps(folderPath: string): string[] {
    return listProjectMcpsImpl(folderPath);
  }

  listProjectSkills(folderPath: string): string[] {
    return listProjectSkillsImpl(folderPath);
  }

  listProjectAgents(folderPath: string): string[] {
    return listProjectAgentsImpl(folderPath);
  }

  installIdeafyMcp(folderPath: string): Result {
    return installIdeafyMcpImpl(folderPath);
  }

  removeIdeafyMcp(folderPath: string): Result {
    return removeIdeafyMcpImpl(folderPath);
  }

  hasIdeafyMcp(folderPath: string): boolean {
    return hasIdeafyMcpImpl(folderPath);
  }

  installIdeafySkills(folderPath: string): Result {
    try {
      const commandsDir = path.join(folderPath, ".claude", "commands");
      if (!fs.existsSync(commandsDir)) fs.mkdirSync(commandsDir, { recursive: true });

      for (const file of SKILL_FILES) {
        const targetPath = path.join(commandsDir, file);
        const name = file.replace(/\.md$/, "");
        const bundledContent = readSkill(name);
        if (shouldUpdateSkill(bundledContent, targetPath)) {
          fs.writeFileSync(targetPath, bundledContent);
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  removeIdeafySkills(folderPath: string): Result {
    try {
      const commandsDir = path.join(folderPath, ".claude", "commands");
      for (const file of SKILL_FILES) {
        const p = path.join(commandsDir, file);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      try {
        if (fs.existsSync(commandsDir) && fs.readdirSync(commandsDir).length === 0) fs.rmdirSync(commandsDir);
      } catch { /* ignore cleanup */ }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  hasIdeafySkills(folderPath: string): boolean {
    try {
      const commandsDir = path.join(folderPath, ".claude", "commands");
      return SKILL_FILES.every((file) => fs.existsSync(path.join(commandsDir, file)));
    } catch {
      return false;
    }
  }

  // Claude-specific: Hooks support
  installIdeafyHook(folderPath: string): Result {
    // Delegate to the hooks module (imported lazily to avoid circular deps)
    const { installIdeafyHook } = require("../hooks");
    return installIdeafyHook(folderPath);
  }

  removeIdeafyHook(folderPath: string): Result {
    const { removeIdeafyHook } = require("../hooks");
    return removeIdeafyHook(folderPath);
  }
}

export const claudeProvider = new ClaudeProvider();
