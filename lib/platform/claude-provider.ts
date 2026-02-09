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

const MCP_SERVER_PATH = path.resolve(process.cwd(), "mcp-server/index.ts");

const HUMAN_TEST_SKILL = `---
allowed-tools: Read, Bash, Grep, Glob, mcp__kanban__create_card, mcp__kanban__save_tests, mcp__kanban__get_project_by_folder
argument-hint: [optional title]
description: Create a kanban card from current conversation context and move to Human Test
---

# Human Test Card Creator

Create a kanban card from the current conversation and move it to Human Test.

Optional argument: $ARGUMENTS (card title override)

## Instructions

### Step 1: Project Detection

Use \`mcp__kanban__get_project_by_folder\` with the current working directory to check if this project exists in kanban.

If the response has \`found: false\`:
- STOP immediately
- Tell the user the message from the response
- Do NOT proceed further

If \`found: true\`, extract the \`project.id\` and continue.

### Step 2: Context Analysis

Analyze the current conversation to extract:

1. **Title**: What was the main task/fix? Use $ARGUMENTS if provided, otherwise infer from conversation.

2. **Description (Details)**:
   - What was the problem?
   - What was the root cause?
   - Include relevant file paths and code references

3. **Solution Summary**:
   - What was changed?
   - Which files were modified?
   - Include code snippets showing before/after if applicable

4. **Test Scenarios**: MUST use this exact format:
   \`\`\`markdown
   ## Test Senaryolari

   ### [Feature/Area Name 1]
   - [ ] Test case 1
   - [ ] Test case 2

   ### [Feature/Area Name 2]
   - [ ] Test case 3
   - [ ] Test case 4
   \`\`\`

   Rules:
   - Group tests under descriptive H3 headings (###)
   - Each test item MUST start with \`- [ ]\` (checkbox format)
   - Include happy path, edge cases, and regression tests
   - NEVER use bullet points (-) without checkbox ([ ])

5. **Complexity**: Assess based on:
   - simple: Single file, straightforward fix
   - medium: Multiple files, moderate logic
   - complex: Architectural changes, many files

6. **Priority**: Assess based on:
   - low: Nice to have
   - medium: Should be done
   - high: Blocking or critical

### Step 3: Create Card

Use \`mcp__kanban__create_card\` with:
- title: Extracted title
- description: Detailed problem description in markdown
- solutionSummary: Solution details in markdown
- status: "progress" (will be moved to test after adding test scenarios)
- complexity: Assessed complexity
- priority: Assessed priority
- projectId: ID from Step 1

### Step 4: Add Tests and Move to Human Test

Use \`mcp__kanban__save_tests\` with:
- id: Card ID from Step 3
- testScenarios: Test scenarios in markdown with checkboxes

### Step 5: Confirm

Report to user:
- Card display ID (e.g., KAN-64)
- Title
- Link hint: "Kanban'da Human Test kolonunda gorebilirsin"

## Important Notes

- Always write description, solution, and tests in the language the conversation was conducted in
- Be thorough with test scenarios - think like a QA engineer
- Include both functional and edge case tests
- Reference specific file paths and line numbers where relevant
`;

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
    return `cd "${workingDir}" && KANBAN_CARD_ID="${opts.cardId}" claude "${cleanPrompt}"${permissionFlag}`;
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

  parseStreamLine(line: string): StreamEvent | null {
    if (!line.trim()) return null;

    try {
      const json = JSON.parse(line);

      // Handle assistant message with content
      if (json.type === "assistant" && json.message?.content) {
        for (const block of json.message.content) {
          if (block.type === "text" && block.text) {
            return { type: "text", data: block.text };
          }
          if (block.type === "thinking" && block.thinking) {
            return { type: "thinking", data: block.thinking };
          }
          if (block.type === "tool_use") {
            return { type: "tool_use", data: { name: block.name, input: block.input } };
          }
        }
      }

      // Handle streaming content
      if (json.type === "content_block_delta") {
        if (json.delta?.text) {
          return { type: "text", data: json.delta.text };
        }
        if (json.delta?.thinking) {
          return { type: "thinking", data: json.delta.thinking };
        }
      }

      // Handle tool results
      if (json.type === "tool_result") {
        return { type: "tool_result", data: { name: json.name, output: json.output?.slice?.(0, 200) } };
      }

      // Handle system messages
      if (json.type === "system" && json.subtype && json.subtype !== "init") {
        return { type: "system", data: { subtype: json.subtype, message: json.message } };
      }

      return null;
    } catch {
      return null;
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

  installKanbanMcp(folderPath: string): Result {
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
      if (existingMcpServers.kanban) return { success: true };

      const mergedSettings = {
        ...existingSettings,
        mcpServers: {
          ...existingMcpServers,
          kanban: { command: "npx", args: ["tsx", MCP_SERVER_PATH] },
        },
      };

      fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  removeKanbanMcp(folderPath: string): Result {
    try {
      const settingsPath = path.join(folderPath, ".claude", "settings.json");
      if (!fs.existsSync(settingsPath)) return { success: true };

      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      if (!settings.mcpServers?.kanban) return { success: true };

      delete settings.mcpServers.kanban;
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

  hasKanbanMcp(folderPath: string): boolean {
    try {
      const settingsPath = path.join(folderPath, ".claude", "settings.json");
      if (!fs.existsSync(settingsPath)) return false;
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      return !!settings.mcpServers?.kanban;
    } catch {
      return false;
    }
  }

  installKanbanSkills(folderPath: string): Result {
    try {
      const commandsDir = path.join(folderPath, ".claude", "commands");
      const skillPath = path.join(commandsDir, "human-test.md");
      if (!fs.existsSync(commandsDir)) fs.mkdirSync(commandsDir, { recursive: true });
      if (fs.existsSync(skillPath)) return { success: true };
      fs.writeFileSync(skillPath, HUMAN_TEST_SKILL);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  removeKanbanSkills(folderPath: string): Result {
    try {
      const commandsDir = path.join(folderPath, ".claude", "commands");
      const skillPath = path.join(commandsDir, "human-test.md");
      if (!fs.existsSync(skillPath)) return { success: true };
      fs.unlinkSync(skillPath);
      try {
        if (fs.readdirSync(commandsDir).length === 0) fs.rmdirSync(commandsDir);
      } catch { /* ignore cleanup */ }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  hasKanbanSkills(folderPath: string): boolean {
    try {
      return fs.existsSync(path.join(folderPath, ".claude", "commands", "human-test.md"));
    } catch {
      return false;
    }
  }

  // Claude-specific: Hooks support
  installKanbanHook(folderPath: string): Result {
    // Delegate to the hooks module (imported lazily to avoid circular deps)
    const { installKanbanHook } = require("../hooks");
    return installKanbanHook(folderPath);
  }

  removeKanbanHook(folderPath: string): Result {
    const { removeKanbanHook } = require("../hooks");
    return removeKanbanHook(folderPath);
  }
}

export const claudeProvider = new ClaudeProvider();
