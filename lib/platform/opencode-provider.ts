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
import { buildMcpInvocation } from "./mcp-invocation";

let cachedOpenCodePath: string | null = null;

type OpenCodeEvent = {
  type?: string;
  timestamp?: number;
  sessionID?: string;
  part?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  payload?: {
    type?: string;
    properties?: Record<string, unknown>;
  };
};

function extractEvent(raw: unknown): { type: string; properties: Record<string, unknown> } | null {
  if (!raw || typeof raw !== "object") return null;

  const candidate = raw as OpenCodeEvent;
  if (candidate.payload?.type) {
    return {
      type: candidate.payload.type,
      properties: candidate.payload.properties ?? {},
    };
  }

  if (candidate.type) {
    const properties: Record<string, unknown> = {
      ...(candidate.properties ?? {}),
      ...(candidate.sessionID ? { sessionID: candidate.sessionID } : {}),
      ...(candidate.timestamp ? { timestamp: candidate.timestamp } : {}),
      ...(candidate.part ? { part: candidate.part } : {}),
    };
    return {
      type: candidate.type,
      properties,
    };
  }

  return null;
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parse failures and fall back to empty object
  }

  return {};
}

function writeJsonFile(filePath: string, data: Record<string, unknown>) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function buildOpenCodeResultFromStream(stdout: string): CliResponse {
  let result = "";
  let isError = false;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    try {
      const parsed = JSON.parse(line) as unknown;
      const event = extractEvent(parsed);
      if (!event) continue;

      if (event.type === "message.part.delta") {
        const field = String(event.properties.field || "");
        const delta = String(event.properties.delta || "");
        if (field === "text") {
          result += delta;
        }
      }

      if (event.type === "text") {
        const part = event.properties.part as Record<string, unknown> | undefined;
        const text = typeof part?.text === "string" ? part.text : "";
        if (text) {
          result += text;
        }
      }

      if (event.type === "message.part.updated") {
        const part = event.properties.part as Record<string, unknown> | undefined;
        if (!part || typeof part !== "object") continue;

        if (part.type === "tool") {
          const state = part.state as Record<string, unknown> | undefined;
          if (state?.status === "error") {
            isError = true;
          }
        }
      }

      if (event.type === "session.error") {
        isError = true;
      }

      if (event.type === "tool_use") {
        const part = event.properties.part as Record<string, unknown> | undefined;
        const state = part?.state as Record<string, unknown> | undefined;
        if (state?.status === "error") {
          isError = true;
        }
      }
    } catch {
      // ignore malformed lines
    }
  }

  return { result: result.trim(), isError };
}

class OpenCodeProvider implements PlatformProvider {
  id = "opencode" as const;
  displayName = "OpenCode";
  installCommand = "npm install -g opencode-ai@latest";

  capabilities: PlatformCapabilities = {
    supportsAutonomousMode: true,
    supportsStreamJson: true,
    supportsPermissionModes: true,
    supportsHooks: false,
    supportsSkills: true,
    supportsMcp: true,
    supportsAgents: true,
    supportsSessionResume: true,
    mcpConfigFormat: "json",
  };

  getCliPath(): string {
    if (cachedOpenCodePath) return cachedOpenCodePath;

    const home = process.env.HOME || process.env.USERPROFILE || "";
    const candidates = [
      join(home, ".local", "bin", "opencode"),
      join(home, ".opencode", "bin", "opencode"),
      "/opt/homebrew/bin/opencode",
      "/usr/local/bin/opencode",
    ];

    cachedOpenCodePath = findBinary("opencode", candidates);
    return cachedOpenCodePath;
  }

  getEnv(): NodeJS.ProcessEnv {
    return buildEnv();
  }

  getCIEnv(): NodeJS.ProcessEnv {
    return buildCIEnv();
  }

  buildAutonomousArgs(opts: AutonomousOptions): string[] {
    return ["run", "--format", "json", opts.prompt];
  }

  buildInteractiveCommand(opts: InteractiveOptions, workingDir: string): InteractiveInvocation {
    const cleanPrompt = opts.prompt.replace(/\n/g, " ");
    const argv = [this.getCliPath()];

    if (opts.permissionMode === "plan") {
      argv.push("--agent", "plan");
    }

    argv.push("--prompt", cleanPrompt);

    return {
      cwd: workingDir,
      argv,
    };
  }

  buildStreamArgs(opts: StreamOptions): string[] {
    const args = ["run", "--format", "json"];

    if (!opts.skipPermissions) {
      args.push("--agent", "plan");
    }

    if (opts.skipPermissions) {
      args.push("--dangerously-skip-permissions");
    }

    if (opts.resumeSessionId) {
      args.push("--session", opts.resumeSessionId);
    }

    args.push(opts.prompt);
    return args;
  }

  parseJsonResponse(stdout: string): CliResponse {
    return buildOpenCodeResultFromStream(stdout);
  }

  parseStreamLine(line: string): StreamEvent[] {
    if (!line.trim()) return [];

    try {
      const parsed = JSON.parse(line) as unknown;
      const event = extractEvent(parsed);
      if (!event) return [];

      const events: StreamEvent[] = [];
      const sessionId = event.properties.sessionID;
      if (typeof sessionId === "string") {
        events.push({ type: "session_id", data: sessionId });
      }

      if (event.type === "message.part.delta") {
        const field = String(event.properties.field || "");
        const delta = String(event.properties.delta || "");

        if (!delta) return events;
        if (field === "text") {
          events.push({ type: "text", data: delta });
        } else if (field === "reasoning.text") {
          events.push({ type: "thinking", data: delta });
        }

        return events;
      }

      if (event.type === "message.part.updated") {
        const part = event.properties.part as Record<string, unknown> | undefined;
        if (!part || typeof part !== "object") return events;

        if (part.type === "reasoning" && typeof part.text === "string") {
          events.push({ type: "thinking", data: part.text });
        }

        if (part.type === "tool") {
          const state = part.state as Record<string, unknown> | undefined;
          const toolName = typeof part.tool === "string" ? part.tool : "";
          if (!state || typeof state !== "object") return events;

          if (state.status === "running" || state.status === "pending") {
            events.push({
              type: "tool_use",
              data: { name: toolName, input: (state.input as Record<string, unknown>) || {} },
            });
          }

          if (state.status === "completed") {
            events.push({
              type: "tool_result",
              data: { name: toolName, output: String(state.output || "").slice(0, 200) },
            });
          }

          if (state.status === "error") {
            events.push({
              type: "tool_result",
              data: { name: toolName, output: String(state.error || "Tool failed").slice(0, 200) },
            });
          }
        }

        // step-finish carries per-step usage stats (reason, cost, tokens).
        // It is metadata, not user-visible content — emitting as "result"
        // would let the route concatenate the raw JSON into the assistant
        // message body. Drop it.

        return events;
      }

      if (event.type === "text") {
        const part = event.properties.part as Record<string, unknown> | undefined;
        if (part?.type === "text" && typeof part.text === "string") {
          events.push({ type: "text", data: part.text });
        }
        return events;
      }

      if (event.type === "step_finish") {
        // Same reasoning as the message.part.updated step-finish branch above.
        return events;
      }

      if (event.type === "tool_use") {
        const part = event.properties.part as Record<string, unknown> | undefined;
        const state = part?.state as Record<string, unknown> | undefined;
        const toolName = typeof part?.tool === "string" ? part.tool : "";

        if (!part || part.type !== "tool" || !state) return events;

        events.push({
          type: "tool_use",
          data: { name: toolName, input: (state.input as Record<string, unknown>) || {} },
        });

        if (state.status === "completed") {
          events.push({
            type: "tool_result",
            data: { name: toolName, output: String(state.output || "").slice(0, 200) },
          });
        }

        if (state.status === "error") {
          events.push({
            type: "tool_result",
            data: { name: toolName, output: String(state.error || "Tool failed").slice(0, 200) },
          });
        }

        return events;
      }

      if (event.type === "session.created" || event.type === "session.updated") {
        const info = event.properties.info as Record<string, unknown> | undefined;
        if (info?.id && typeof info.id === "string") {
          events.push({ type: "session_id", data: info.id });
        }
        return events;
      }

      if (event.type === "session.error") {
        const error = event.properties.error;
        if (typeof error === "string") {
          events.push({ type: "system", data: error });
        }
      }

      return events;
    } catch {
      return [];
    }
  }

  getDefaultSkillsPath(): string {
    return "~/.config/opencode/skills";
  }

  getDefaultMcpConfigPath(): string {
    return "~/.config/opencode/opencode.json";
  }

  getDefaultAgentsPath(): string {
    return "~/.config/opencode/agents";
  }

  getProjectConfigDir(): string {
    return ".opencode";
  }

  listProjectMcps(folderPath: string): string[] {
    try {
      const configPath = path.join(folderPath, "opencode.json");
      const config = readJsonFile(configPath);
      const mcp = config.mcp;
      if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) return [];
      return Object.keys(mcp as Record<string, unknown>).sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  listProjectSkills(folderPath: string): string[] {
    try {
      const skillsDir = path.join(folderPath, ".opencode", "skills");
      if (!fs.existsSync(skillsDir)) return [];
      return fs.readdirSync(skillsDir)
        .filter((entry) => {
          const entryPath = path.join(skillsDir, entry);
          return fs.statSync(entryPath).isDirectory() && fs.existsSync(path.join(entryPath, "SKILL.md"));
        })
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  listProjectAgents(folderPath: string): string[] {
    try {
      const agentsDir = path.join(folderPath, ".opencode", "agents");
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
      const configPath = path.join(folderPath, "opencode.json");
      const existing = readJsonFile(configPath);
      const currentMcp = existing.mcp;
      const nextMcp = (currentMcp && typeof currentMcp === "object" && !Array.isArray(currentMcp))
        ? { ...(currentMcp as Record<string, unknown>) }
        : {};

      if (!nextMcp.ideafy) {
        const invocation = buildMcpInvocation();
        nextMcp.ideafy = {
          type: "local",
          command: [invocation.command, ...invocation.args],
          enabled: true,
          ...(invocation.env ? { environment: invocation.env } : {}),
        };
      }

      writeJsonFile(configPath, {
        ...existing,
        $schema: existing.$schema || "https://opencode.ai/config.json",
        mcp: nextMcp,
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  removeIdeafyMcp(folderPath: string): Result {
    try {
      const configPath = path.join(folderPath, "opencode.json");
      if (!fs.existsSync(configPath)) return { success: true };

      const existing = readJsonFile(configPath);
      const currentMcp = existing.mcp;
      if (!currentMcp || typeof currentMcp !== "object" || Array.isArray(currentMcp)) {
        return { success: true };
      }

      const nextMcp = { ...(currentMcp as Record<string, unknown>) };
      delete nextMcp.ideafy;

      const nextConfig: Record<string, unknown> = { ...existing };
      if (Object.keys(nextMcp).length > 0) {
        nextConfig.mcp = nextMcp;
      } else {
        delete nextConfig.mcp;
      }

      writeJsonFile(configPath, nextConfig);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  hasIdeafyMcp(folderPath: string): boolean {
    try {
      const configPath = path.join(folderPath, "opencode.json");
      const config = readJsonFile(configPath);
      return !!(config.mcp && typeof config.mcp === "object" && !Array.isArray(config.mcp) && "ideafy" in config.mcp);
    } catch {
      return false;
    }
  }

  installIdeafySkills(folderPath: string): Result {
    try {
      const skillsDir = path.join(folderPath, ".opencode", "skills");

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
      const skillsDir = path.join(folderPath, ".opencode", "skills");

      for (const file of SKILL_FILES) {
        const skillName = file.replace(/\.md$/, "");
        const skillDir = path.join(skillsDir, skillName);
        if (fs.existsSync(skillDir)) {
          fs.rmSync(skillDir, { recursive: true, force: true });
        }
      }

      try {
        if (fs.existsSync(skillsDir) && fs.readdirSync(skillsDir).length === 0) {
          fs.rmdirSync(skillsDir);
        }
      } catch {
        // ignore cleanup failures
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  hasIdeafySkills(folderPath: string): boolean {
    try {
      const skillsDir = path.join(folderPath, ".opencode", "skills");
      return SKILL_FILES.every((file) => {
        const skillName = file.replace(/\.md$/, "");
        return fs.existsSync(path.join(skillsDir, skillName, "SKILL.md"));
      });
    } catch {
      return false;
    }
  }
}

export const opencodeProvider = new OpenCodeProvider();
