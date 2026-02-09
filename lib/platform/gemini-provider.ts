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

let cachedGeminiPath: string | null = null;

class GeminiProvider implements PlatformProvider {
  id = "gemini" as const;
  displayName = "Gemini CLI";
  installCommand = "npm install -g @google/gemini-cli";

  capabilities: PlatformCapabilities = {
    supportsAutonomousMode: true,
    supportsStreamJson: true,
    supportsPermissionModes: false,
    supportsHooks: false,
    supportsSkills: true,
    supportsMcp: true,
    mcpConfigFormat: "json",
  };

  getCliPath(): string {
    if (cachedGeminiPath) return cachedGeminiPath;

    const home = process.env.HOME || process.env.USERPROFILE || "";
    const candidates = [
      join(home, ".local", "bin", "gemini"),
      "/usr/local/bin/gemini",
      "/opt/homebrew/bin/gemini",
    ];

    cachedGeminiPath = findBinary("gemini", candidates);
    return cachedGeminiPath;
  }

  getEnv(): NodeJS.ProcessEnv {
    return buildEnv();
  }

  getCIEnv(): NodeJS.ProcessEnv {
    return buildCIEnv();
  }

  buildAutonomousArgs(opts: AutonomousOptions): string[] {
    return ["-p", opts.prompt, "--output-format", "json"];
  }

  buildInteractiveCommand(opts: InteractiveOptions, workingDir: string): string {
    const cleanPrompt = opts.prompt.replace(/\n/g, " ");
    return `cd "${workingDir}" && gemini -p "${cleanPrompt}"`;
  }

  buildStreamArgs(opts: StreamOptions): string[] {
    return ["-p", opts.prompt, "--output-format", "stream-json"];
  }

  parseJsonResponse(stdout: string): CliResponse {
    try {
      const response = JSON.parse(stdout);
      return {
        result: response.result || response.text || "",
        cost: response.cost_usd,
        duration: response.duration_ms,
        isError: !!response.is_error,
      };
    } catch {
      return { result: stdout.trim(), isError: false };
    }
  }

  parseStreamLine(line: string): StreamEvent | null {
    if (!line.trim()) return null;
    try {
      const json = JSON.parse(line);
      if (json.type === "text" || json.text) {
        return { type: "text", data: json.text || json.data };
      }
      return null;
    } catch {
      return null;
    }
  }

  getDefaultSkillsPath(): string {
    return "~/.gemini/skills";
  }

  getDefaultMcpConfigPath(): string {
    return "~/.gemini/settings.json";
  }

  getProjectConfigDir(): string {
    return ".gemini";
  }

  // ── Extension methods (stubs - Gemini MCP format TBD) ──

  listProjectMcps(folderPath: string): string[] {
    try {
      const settingsPath = path.join(folderPath, ".gemini", "settings.json");
      if (!fs.existsSync(settingsPath)) return [];
      const content = fs.readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      return Object.keys(settings.mcpServers || {}).sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  listProjectSkills(): string[] {
    return []; // Gemini doesn't support skills
  }

  installKanbanMcp(folderPath: string): Result {
    try {
      const geminiDir = path.join(folderPath, ".gemini");
      const settingsPath = path.join(geminiDir, "settings.json");

      if (!fs.existsSync(geminiDir)) {
        fs.mkdirSync(geminiDir, { recursive: true });
      }

      let existingSettings: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          existingSettings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
        } catch {
          existingSettings = {};
        }
      }

      const existing = (existingSettings.mcpServers as Record<string, unknown>) || {};
      if (existing.kanban) return { success: true };

      const merged = {
        ...existingSettings,
        mcpServers: {
          ...existing,
          kanban: {
            command: "npx",
            args: ["tsx", path.resolve(process.cwd(), "mcp-server/index.ts")],
          },
        },
      };

      fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  removeKanbanMcp(folderPath: string): Result {
    try {
      const settingsPath = path.join(folderPath, ".gemini", "settings.json");
      if (!fs.existsSync(settingsPath)) return { success: true };

      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      if (!settings.mcpServers?.kanban) return { success: true };

      delete settings.mcpServers.kanban;
      if (Object.keys(settings.mcpServers).length === 0) delete settings.mcpServers;

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  hasKanbanMcp(folderPath: string): boolean {
    try {
      const settingsPath = path.join(folderPath, ".gemini", "settings.json");
      if (!fs.existsSync(settingsPath)) return false;
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      return !!settings.mcpServers?.kanban;
    } catch {
      return false;
    }
  }

  installKanbanSkills(): Result {
    return { success: false, error: "Gemini CLI does not support skills" };
  }

  removeKanbanSkills(): Result {
    return { success: false, error: "Gemini CLI does not support skills" };
  }

  hasKanbanSkills(): boolean {
    return false;
  }
}

export const geminiProvider = new GeminiProvider();
