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
  Result,
} from "./types";
import { findBinary, buildEnv, buildCIEnv } from "./base-provider";
import { appResourcesRoot, resolveUserSkillsDir } from "../paths";
import { parseClaudeStreamLine } from "./claude-provider/parse-stream-line";
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
      "--output-format", "json",
      "--setting-sources", "user",
    ];
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
    ];

    if (opts.skipPermissions) {
      args.push("--dangerously-skip-permissions");
    }

    if (opts.resumeSessionId) {
      args.push("--resume", opts.resumeSessionId);
    } else {
      if (opts.newSessionId) {
        args.push("--session-id", opts.newSessionId);
      }
      if (!opts.skipPermissions && opts.allowedTools?.length) {
        args.push("--allowedTools", ...opts.allowedTools);
      }
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
        cost: response.cost_usd,
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
        if (!fs.existsSync(targetPath)) {
          const name = file.replace(/\.md$/, "");
          fs.writeFileSync(targetPath, readSkill(name));
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
