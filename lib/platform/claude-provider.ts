import * as fs from "fs";
import * as path from "path";
import { join } from "path";
import type {
  PlatformProvider,
  PlatformCapabilities,
  AutonomousOptions,
  InteractiveOptions,
  StreamOptions,
  CliResponse,
  StreamEvent,
  Result,
} from "./types";
import { findBinary, buildEnv, buildCIEnv } from "./base-provider";

const IDEAFY_ROOT = process.env.IDEAFY_ROOT || process.cwd();
const MCP_SERVER_PATH = path.join(IDEAFY_ROOT, "mcp-server", "index.ts");
const SKILLS_DIR = path.join(IDEAFY_ROOT, "skills");
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
    return [
      "-p", opts.prompt,
      "--dangerously-skip-permissions",
      "--output-format", "json",
      "--setting-sources", "user",
    ];
  }

  buildInteractiveCommand(opts: InteractiveOptions, workingDir: string): string {
    const permissionFlag = opts.permissionMode
      ? ` --permission-mode ${opts.permissionMode}`
      : "";
    // Escape the prompt for shell usage - replace newlines with spaces
    const cleanPrompt = opts.prompt.replace(/\n/g, " ");
    // Use single quotes to prevent shell interpretation of special chars ([], $, ", etc.)
    const escaped = cleanPrompt.replace(/'/g, "'\\''");
    return `cd "${workingDir}" && KANBAN_CARD_ID="${opts.cardId}" claude '${escaped}'${permissionFlag}`;
  }

  buildStreamArgs(opts: StreamOptions): string[] {
    const args = [
      "-p", opts.prompt,
      "--print",
      "--output-format", "stream-json",
      "--verbose",
    ];
    if (opts.allowedTools?.length) {
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
        cost: response.cost_usd,
        duration: response.duration_ms,
        isError: !!response.is_error,
      };
    } catch {
      return { result: stdout.trim(), isError: false };
    }
  }

  parseStreamLine(line: string): StreamEvent[] {
    if (!line.trim()) return [];

    try {
      const json = JSON.parse(line);
      const events: StreamEvent[] = [];

      // Handle assistant message with content (may have multiple blocks)
      if (json.type === "assistant" && json.message?.content) {
        for (const block of json.message.content) {
          if (block.type === "text" && block.text) {
            events.push({ type: "text", data: block.text });
          }
          if (block.type === "thinking" && block.thinking) {
            events.push({ type: "thinking", data: block.thinking });
          }
          if (block.type === "tool_use") {
            events.push({ type: "tool_use", data: { name: block.name, input: block.input } });
          }
        }
      }

      // Handle streaming content
      if (json.type === "content_block_delta") {
        if (json.delta?.text) {
          events.push({ type: "text", data: json.delta.text });
        }
        if (json.delta?.thinking) {
          events.push({ type: "thinking", data: json.delta.thinking });
        }
      }

      // Handle tool results
      if (json.type === "tool_result") {
        events.push({ type: "tool_result", data: { name: json.name, output: json.output?.slice?.(0, 200) } });
      }

      // Handle final result - captures response text after tool use
      if (json.type === "result" && json.result) {
        events.push({ type: "result", data: String(json.result) });
      }

      // Handle system messages
      if (json.type === "system" && json.subtype && json.subtype !== "init") {
        events.push({ type: "system", data: { subtype: json.subtype, message: json.message } });
      }

      return events;
    } catch {
      return [];
    }
  }

  getDefaultSkillsPath(): string {
    return "~/.claude/skills";
  }

  getDefaultMcpConfigPath(): string {
    return "~/.claude.json";
  }

  getProjectConfigDir(): string {
    return ".claude";
  }

  // ── Extension methods ──

  listProjectMcps(folderPath: string): string[] {
    try {
      const settingsPath = path.join(folderPath, ".claude", "settings.json");
      if (!fs.existsSync(settingsPath)) return [];
      const content = fs.readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      return Object.keys(settings.mcpServers || {}).sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  listProjectSkills(folderPath: string): string[] {
    try {
      const commandsDir = path.join(folderPath, ".claude", "commands");
      if (!fs.existsSync(commandsDir)) return [];
      return fs.readdirSync(commandsDir)
        .filter((entry) => {
          if (entry.startsWith(".")) return false;
          if (!entry.endsWith(".md")) return false;
          return fs.statSync(path.join(commandsDir, entry)).isFile();
        })
        .map((entry) => entry.replace(/\.md$/, ""))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  installIdeafyMcp(folderPath: string): Result {
    try {
      const claudeDir = path.join(folderPath, ".claude");
      const settingsPath = path.join(claudeDir, "settings.json");

      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      let existingSettings: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          existingSettings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
        } catch {
          existingSettings = {};
        }
      }

      const existingMcpServers = (existingSettings.mcpServers as Record<string, unknown>) || {};
      if (existingMcpServers.ideafy) return { success: true };

      const mergedSettings = {
        ...existingSettings,
        mcpServers: {
          ...existingMcpServers,
          ideafy: { command: "npx", args: ["tsx", MCP_SERVER_PATH] },
        },
      };

      fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  removeIdeafyMcp(folderPath: string): Result {
    try {
      const settingsPath = path.join(folderPath, ".claude", "settings.json");
      if (!fs.existsSync(settingsPath)) return { success: true };

      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      if (!settings.mcpServers?.ideafy) return { success: true };

      delete settings.mcpServers.ideafy;
      if (Object.keys(settings.mcpServers).length === 0) delete settings.mcpServers;

      fs.writeFileSync(settingsPath,
        Object.keys(settings).length === 0
          ? JSON.stringify({}, null, 2)
          : JSON.stringify(settings, null, 2)
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  hasIdeafyMcp(folderPath: string): boolean {
    try {
      const settingsPath = path.join(folderPath, ".claude", "settings.json");
      if (!fs.existsSync(settingsPath)) return false;
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      return !!settings.mcpServers?.ideafy;
    } catch {
      return false;
    }
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
