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
import { convertSkillToSkillMd, SKILL_FILES } from "./skill-converter";
import { appResourcesRoot } from "../paths";
import { buildMcpInvocation } from "./mcp-invocation";

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
    supportsAgents: true,
    supportsSessionResume: true,
    mcpConfigFormat: "json",
  };

  getCliPath(): string {
    if (cachedGeminiPath) return cachedGeminiPath;

    const home = process.env.HOME || process.env.USERPROFILE || "";
    // Check NVM path first (user's active Node version), then common locations
    const nvmDir = process.env.NVM_DIR || join(home, ".nvm");
    const nodeVersion = process.version;
    const candidates = [
      join(nvmDir, "versions", "node", nodeVersion, "bin", "gemini"),
      join(home, ".local", "bin", "gemini"),
      "/opt/homebrew/bin/gemini",
      "/usr/local/bin/gemini",
    ];

    cachedGeminiPath = findBinary("gemini", candidates);
    return cachedGeminiPath;
  }

  getEnv(): NodeJS.ProcessEnv {
    // Headless Gemini refuses to run in untrusted folders unless this env or
    // --skip-trust is set. Card chat always runs against arbitrary project dirs.
    return { ...buildEnv(), GEMINI_CLI_TRUST_WORKSPACE: "true" };
  }

  getCIEnv(): NodeJS.ProcessEnv {
    return { ...buildCIEnv(), GEMINI_CLI_TRUST_WORKSPACE: "true" };
  }

  buildAutonomousArgs(opts: AutonomousOptions): string[] {
    return ["-p", opts.prompt, "--output-format", "json"];
  }

  buildInteractiveCommand(opts: InteractiveOptions, workingDir: string): InteractiveInvocation {
    const cleanPrompt = opts.prompt.replace(/\n/g, " ");
    return {
      cwd: workingDir,
      argv: [this.getCliPath(), "-p", cleanPrompt],
    };
  }

  buildStreamArgs(opts: StreamOptions): string[] {
    // Gemini CLI doesn't support allowedTools or addDirs flags.
    // Approval modes: yolo auto-approves every tool/MCP call; default prompts
    // (which would hang headless), so when not bypassing we still need
    // auto_edit at minimum to keep edits unattended.
    const approvalArgs = opts.skipPermissions
      ? ["--yolo"]
      : ["--approval-mode", "auto_edit"];

    if (opts.resumeSessionId) {
      return [
        "--resume",
        opts.resumeSessionId,
        ...approvalArgs,
        "-p",
        opts.prompt,
        "--output-format",
        "stream-json",
      ];
    }
    return [...approvalArgs, "-p", opts.prompt, "--output-format", "stream-json"];
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

  parseStreamLine(line: string): StreamEvent[] {
    if (!line.trim()) return [];
    try {
      const json = JSON.parse(line);
      const events: StreamEvent[] = [];

      // Emit session ID from init so the caller can persist it without
      // guessing the ~/.gemini/tmp/<hash>/chats/ path (layout varies by version)
      if (json.type === "init") {
        if (json.session_id) {
          events.push({ type: "session_id", data: String(json.session_id) });
        }
        return events;
      }
      if (json.type === "message" && json.role === "user") return [];

      // Gemini emits each assistant chunk as `{delta:true, content:<full text
      // so far>}` — content is an accumulated snapshot, not a delta. Treating
      // it as a delta and appending would cascade-duplicate the response, so
      // we emit `text_replace` and the consumer overwrites instead. The
      // optional `delta:false` consolidated tail repeats the same snapshot,
      // skip it.
      if (json.type === "message" && json.role === "assistant" && json.content) {
        if (json.delta === false) return [];
        events.push({ type: "text_replace", data: String(json.content) });
      }

      // Handle tool use events
      if (json.type === "tool_use") {
        events.push({
          type: "tool_use",
          data: {
            name: json.tool_name || json.name || json.tool_id || "tool",
            input: json.parameters || json.input,
          },
        });
      }

      // Handle tool result events
      if (json.type === "tool_result") {
        events.push({
          type: "tool_result",
          data: {
            name: json.tool_name || json.name || json.tool_id || "tool",
            output: String(json.output || "").slice(0, 200),
          },
        });
      }

      // Handle result event (final stats/status)
      if (json.type === "result") {
        // Result event in Gemini contains stats, not text - skip
      }

      return events;
    } catch {
      return [];
    }
  }

  getDefaultSkillsPath(): string {
    return "~/.gemini/skills";
  }

  getDefaultMcpConfigPath(): string {
    return "~/.gemini/settings.json";
  }

  getDefaultAgentsPath(): string {
    return "~/.gemini/agents";
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

  listProjectSkills(folderPath: string): string[] {
    try {
      const skillsDir = path.join(folderPath, ".gemini", "skills");
      if (!fs.existsSync(skillsDir)) return [];
      return fs.readdirSync(skillsDir)
        .filter((entry) => {
          const entryPath = path.join(skillsDir, entry);
          if (!fs.statSync(entryPath).isDirectory()) return false;
          return fs.existsSync(path.join(entryPath, "SKILL.md"));
        })
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  listProjectAgents(folderPath: string): string[] {
    try {
      const agentsDir = path.join(folderPath, ".gemini", "agents");
      if (!fs.existsSync(agentsDir)) return [];
      return fs.readdirSync(agentsDir)
        .filter((entry) => {
          if (entry.startsWith(".")) return false;
          if (!entry.endsWith(".md")) return false;
          return fs.statSync(path.join(agentsDir, entry)).isFile();
        })
        .map((entry) => entry.replace(/\.md$/, ""))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  installIdeafyMcp(folderPath: string): Result {
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
      if (existing.ideafy) return { success: true };

      const merged = {
        ...existingSettings,
        mcpServers: {
          ...existing,
          ideafy: buildMcpInvocation(),
        },
      };

      fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  removeIdeafyMcp(folderPath: string): Result {
    try {
      const settingsPath = path.join(folderPath, ".gemini", "settings.json");
      if (!fs.existsSync(settingsPath)) return { success: true };

      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      if (!settings.mcpServers?.ideafy) return { success: true };

      delete settings.mcpServers.ideafy;
      if (Object.keys(settings.mcpServers).length === 0) delete settings.mcpServers;

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  hasIdeafyMcp(folderPath: string): boolean {
    try {
      const settingsPath = path.join(folderPath, ".gemini", "settings.json");
      if (!fs.existsSync(settingsPath)) return false;
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      return !!settings.mcpServers?.ideafy;
    } catch {
      return false;
    }
  }

  installIdeafySkills(folderPath: string): Result {
    try {
      const skillsDir = path.join(folderPath, ".gemini", "skills");

      for (const file of SKILL_FILES) {
        const skillName = file.replace(/\.md$/, "");
        const skillDir = path.join(skillsDir, skillName);
        const skillMdPath = path.join(skillDir, "SKILL.md");

        if (!fs.existsSync(skillMdPath)) {
          fs.mkdirSync(skillDir, { recursive: true });
          fs.writeFileSync(skillMdPath, convertSkillToSkillMd(skillName));
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  removeIdeafySkills(folderPath: string): Result {
    try {
      const skillsDir = path.join(folderPath, ".gemini", "skills");

      for (const file of SKILL_FILES) {
        const skillName = file.replace(/\.md$/, "");
        const skillDir = path.join(skillsDir, skillName);
        if (fs.existsSync(skillDir)) {
          fs.rmSync(skillDir, { recursive: true, force: true });
        }
      }

      // Clean up empty skills dir
      try {
        if (fs.existsSync(skillsDir) && fs.readdirSync(skillsDir).length === 0) {
          fs.rmdirSync(skillsDir);
        }
      } catch { /* ignore cleanup */ }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  hasIdeafySkills(folderPath: string): boolean {
    try {
      const skillsDir = path.join(folderPath, ".gemini", "skills");
      return SKILL_FILES.every((file) => {
        const skillName = file.replace(/\.md$/, "");
        return fs.existsSync(path.join(skillsDir, skillName, "SKILL.md"));
      });
    } catch {
      return false;
    }
  }
}

export const geminiProvider = new GeminiProvider();
