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

let cachedCodexPath: string | null = null;

class CodexProvider implements PlatformProvider {
  id = "codex" as const;
  displayName = "Codex CLI";
  installCommand = "npm install -g @openai/codex";

  capabilities: PlatformCapabilities = {
    supportsAutonomousMode: true,
    supportsStreamJson: true,
    supportsPermissionModes: false,
    supportsHooks: false,
    supportsSkills: true,
    supportsMcp: true,
    supportsAgents: true,
    supportsSessionResume: true,
    mcpConfigFormat: "toml",
  };

  getCliPath(): string {
    if (cachedCodexPath) return cachedCodexPath;

    const home = process.env.HOME || process.env.USERPROFILE || "";
    // Check NVM path first (user's active Node version), then common locations
    const nvmDir = process.env.NVM_DIR || join(home, ".nvm");
    const nodeVersion = process.version; // e.g. "v22.12.0"
    const candidates = [
      join(nvmDir, "versions", "node", nodeVersion, "bin", "codex"),
      join(home, ".local", "bin", "codex"),
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
    ];

    cachedCodexPath = findBinary("codex", candidates);
    return cachedCodexPath;
  }

  getEnv(): NodeJS.ProcessEnv {
    return buildEnv();
  }

  getCIEnv(): NodeJS.ProcessEnv {
    return buildCIEnv();
  }

  buildAutonomousArgs(opts: AutonomousOptions): string[] {
    return ["-q", opts.prompt];
  }

  buildInteractiveCommand(opts: InteractiveOptions, workingDir: string): InteractiveInvocation {
    const cleanPrompt = opts.prompt.replace(/\n/g, " ");
    return {
      cwd: workingDir,
      argv: [this.getCliPath(), cleanPrompt],
    };
  }

  buildStreamArgs(opts: StreamOptions): string[] {
    if (opts.resumeSessionId) {
      return ["exec", "resume", opts.resumeSessionId, "--json", "--full-auto", opts.prompt];
    }
    return ["exec", "--json", "--full-auto", opts.prompt];
  }

  parseJsonResponse(stdout: string): CliResponse {
    // Codex quiet mode just outputs plain text
    return { result: stdout.trim(), isError: false };
  }

  parseStreamLine(line: string): StreamEvent[] {
    if (!line.trim()) return [];
    try {
      const json = JSON.parse(line);
      const events: StreamEvent[] = [];

      // Skip lifecycle events
      if (json.type === "thread.started" || json.type === "turn.started") {
        return [];
      }

      // Handle item.started - command execution starting (tool use indicator)
      if (json.type === "item.started" && json.item) {
        const item = json.item;
        if (item.type === "command_execution" && item.command) {
          events.push({ type: "tool_use", data: { name: "command", input: item.command } });
        }
      }

      // Handle item.completed events
      if (json.type === "item.completed" && json.item) {
        const item = json.item;

        // Reasoning (thinking)
        if (item.type === "reasoning" && item.text) {
          events.push({ type: "thinking", data: item.text });
        }

        // Agent message with text response
        if (item.type === "agent_message" && item.text) {
          events.push({ type: "text", data: item.text });
        }

        // Command execution completed (tool result)
        if (item.type === "command_execution" && item.status === "completed") {
          events.push({ type: "tool_result", data: {
            name: "command",
            output: (item.aggregated_output || "").slice(0, 200),
          }});
        }

        // Function call (tool use)
        if (item.type === "function_call") {
          events.push({ type: "tool_use", data: { name: item.name || "", input: item.arguments || "" } });
        }

        // Function call output (tool result)
        if (item.type === "function_call_output") {
          events.push({ type: "tool_result", data: { name: item.name || "", output: (item.output || "").slice(0, 200) } });
        }
      }

      return events;
    } catch {
      return [];
    }
  }

  getDefaultSkillsPath(): string {
    return "~/.codex/skills";
  }

  getDefaultMcpConfigPath(): string {
    return "~/.codex/config.toml";
  }

  getDefaultAgentsPath(): string {
    return "~/.codex/agents";
  }

  getProjectConfigDir(): string {
    return ".codex";
  }

  // ── Extension methods (stubs - Codex TOML config) ──

  listProjectMcps(folderPath: string): string[] {
    try {
      const configPath = path.join(folderPath, ".codex", "config.toml");
      if (!fs.existsSync(configPath)) return [];
      // Basic TOML parsing for MCP server names
      const content = fs.readFileSync(configPath, "utf-8");
      const matches = content.matchAll(/\[mcp_servers\.(\w+)\]/g);
      return Array.from(matches, (m) => m[1]).sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  listProjectSkills(folderPath: string): string[] {
    try {
      const skillsDir = path.join(folderPath, ".agents", "skills");
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
      const agentsDir = path.join(folderPath, ".codex", "agents");
      if (!fs.existsSync(agentsDir)) return [];
      return fs.readdirSync(agentsDir)
        .filter((entry) => {
          if (entry.startsWith(".")) return false;
          if (!entry.endsWith(".toml")) return false;
          return fs.statSync(path.join(agentsDir, entry)).isFile();
        })
        .map((entry) => entry.replace(/\.toml$/, ""))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  installIdeafyMcp(folderPath: string): Result {
    try {
      const codexDir = path.join(folderPath, ".codex");
      const configPath = path.join(codexDir, "config.toml");

      if (!fs.existsSync(codexDir)) {
        fs.mkdirSync(codexDir, { recursive: true });
      }

      let content = "";
      if (fs.existsSync(configPath)) {
        content = fs.readFileSync(configPath, "utf-8");
      }

      if (content.includes("[mcp_servers.ideafy]")) return { success: true };

      const mcpServerPath = path.resolve(appResourcesRoot(), "mcp-server/index.ts");
      const tomlBlock = `\n[mcp_servers.ideafy]\ncommand = "npx"\nargs = ["tsx", "${mcpServerPath}"]\n`;

      fs.writeFileSync(configPath, content + tomlBlock);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  removeIdeafyMcp(folderPath: string): Result {
    try {
      const configPath = path.join(folderPath, ".codex", "config.toml");
      if (!fs.existsSync(configPath)) return { success: true };

      let content = fs.readFileSync(configPath, "utf-8");
      // Remove the [mcp_servers.ideafy] block
      content = content.replace(/\n?\[mcp_servers\.ideafy\][^\[]*/g, "");
      fs.writeFileSync(configPath, content.trim() + "\n");
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  hasIdeafyMcp(folderPath: string): boolean {
    try {
      const configPath = path.join(folderPath, ".codex", "config.toml");
      if (!fs.existsSync(configPath)) return false;
      return fs.readFileSync(configPath, "utf-8").includes("[mcp_servers.ideafy]");
    } catch {
      return false;
    }
  }

  installIdeafySkills(folderPath: string): Result {
    try {
      const skillsDir = path.join(folderPath, ".agents", "skills");

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
      const skillsDir = path.join(folderPath, ".agents", "skills");

      for (const file of SKILL_FILES) {
        const skillName = file.replace(/\.md$/, "");
        const skillDir = path.join(skillsDir, skillName);
        if (fs.existsSync(skillDir)) {
          fs.rmSync(skillDir, { recursive: true, force: true });
        }
      }

      // Clean up empty dirs
      try {
        if (fs.existsSync(skillsDir) && fs.readdirSync(skillsDir).length === 0) {
          fs.rmdirSync(skillsDir);
        }
        const agentsDir = path.join(folderPath, ".agents");
        if (fs.existsSync(agentsDir) && fs.readdirSync(agentsDir).length === 0) {
          fs.rmdirSync(agentsDir);
        }
      } catch { /* ignore cleanup */ }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  hasIdeafySkills(folderPath: string): boolean {
    try {
      const skillsDir = path.join(folderPath, ".agents", "skills");
      return SKILL_FILES.every((file) => {
        const skillName = file.replace(/\.md$/, "");
        return fs.existsSync(path.join(skillsDir, skillName, "SKILL.md"));
      });
    } catch {
      return false;
    }
  }
}

export const codexProvider = new CodexProvider();
