import * as fs from "fs";
import * as path from "path";

// Get the MCP server path relative to this file
const MCP_SERVER_PATH = path.resolve(__dirname, "../mcp-server/index.ts");

// Human-test skill content to embed
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

// ============================================================================
// MCP Installation Functions
// ============================================================================

/**
 * Install kanban MCP server to a project's .claude/settings.json
 * Merges with existing settings if present
 */
export function installKanbanMcp(folderPath: string): { success: boolean; error?: string } {
  try {
    const claudeDir = path.join(folderPath, ".claude");
    const settingsPath = path.join(claudeDir, "settings.json");

    // Create .claude directory if it doesn't exist
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    let existingSettings: Record<string, unknown> = {};

    // Read existing settings if present
    if (fs.existsSync(settingsPath)) {
      try {
        const content = fs.readFileSync(settingsPath, "utf-8");
        existingSettings = JSON.parse(content);
      } catch {
        // If parse fails, start fresh
        existingSettings = {};
      }
    }

    // Check if kanban MCP already exists
    const existingMcpServers = (existingSettings.mcpServers as Record<string, unknown>) || {};

    if (existingMcpServers.kanban) {
      return { success: true }; // Already installed
    }

    // Add kanban MCP server
    const mergedSettings = {
      ...existingSettings,
      mcpServers: {
        ...existingMcpServers,
        kanban: {
          command: "npx",
          args: ["tsx", MCP_SERVER_PATH],
        },
      },
    };

    fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));

    return { success: true };
  } catch (error) {
    console.error("Failed to install kanban MCP:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Remove kanban MCP server from a project's .claude/settings.json
 */
export function removeKanbanMcp(folderPath: string): { success: boolean; error?: string } {
  try {
    const settingsPath = path.join(folderPath, ".claude", "settings.json");

    if (!fs.existsSync(settingsPath)) {
      return { success: true }; // Nothing to remove
    }

    const content = fs.readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(content);

    if (!settings.mcpServers?.kanban) {
      return { success: true }; // No kanban MCP to remove
    }

    // Remove kanban from mcpServers
    delete settings.mcpServers.kanban;

    // Clean up empty objects
    if (Object.keys(settings.mcpServers).length === 0) {
      delete settings.mcpServers;
    }

    // Write back or handle empty settings
    if (Object.keys(settings).length === 0) {
      // Don't delete the file - other things might use .claude directory
      fs.writeFileSync(settingsPath, JSON.stringify({}, null, 2));
    } else {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to remove kanban MCP:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check if kanban MCP is installed in a project
 */
export function hasKanbanMcp(folderPath: string): boolean {
  try {
    const settingsPath = path.join(folderPath, ".claude", "settings.json");

    if (!fs.existsSync(settingsPath)) {
      return false;
    }

    const content = fs.readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(content);

    return !!settings.mcpServers?.kanban;
  } catch {
    return false;
  }
}

// ============================================================================
// Skills Installation Functions
// ============================================================================

/**
 * Install kanban skills (commands) to a project's .claude/commands/ directory
 */
export function installKanbanSkills(folderPath: string): { success: boolean; error?: string } {
  try {
    const commandsDir = path.join(folderPath, ".claude", "commands");
    const skillPath = path.join(commandsDir, "human-test.md");

    // Create .claude/commands directory if it doesn't exist
    if (!fs.existsSync(commandsDir)) {
      fs.mkdirSync(commandsDir, { recursive: true });
    }

    // Check if skill already exists
    if (fs.existsSync(skillPath)) {
      return { success: true }; // Already installed
    }

    // Write the skill file
    fs.writeFileSync(skillPath, HUMAN_TEST_SKILL);

    return { success: true };
  } catch (error) {
    console.error("Failed to install kanban skills:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Remove kanban skills (commands) from a project's .claude/commands/ directory
 */
export function removeKanbanSkills(folderPath: string): { success: boolean; error?: string } {
  try {
    const commandsDir = path.join(folderPath, ".claude", "commands");
    const skillPath = path.join(commandsDir, "human-test.md");

    if (!fs.existsSync(skillPath)) {
      return { success: true }; // Nothing to remove
    }

    // Remove the skill file
    fs.unlinkSync(skillPath);

    // Optionally clean up empty commands directory
    try {
      const remainingFiles = fs.readdirSync(commandsDir);
      if (remainingFiles.length === 0) {
        fs.rmdirSync(commandsDir);
      }
    } catch {
      // Ignore cleanup errors
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to remove kanban skills:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check if kanban skills are installed in a project
 */
export function hasKanbanSkills(folderPath: string): boolean {
  try {
    const skillPath = path.join(folderPath, ".claude", "commands", "human-test.md");
    return fs.existsSync(skillPath);
  } catch {
    return false;
  }
}

// ============================================================================
// List Functions (for sidebar)
// ============================================================================

/**
 * List all skills (commands) in a project's .claude/commands/ directory
 */
export function listProjectSkills(folderPath: string): string[] {
  try {
    const commandsDir = path.join(folderPath, ".claude", "commands");

    if (!fs.existsSync(commandsDir)) {
      return [];
    }

    const entries = fs.readdirSync(commandsDir);
    const skills = entries
      .filter((entry) => {
        // Filter markdown files (skills)
        if (entry.startsWith(".")) return false;
        if (!entry.endsWith(".md")) return false;
        const fullPath = path.join(commandsDir, entry);
        return fs.statSync(fullPath).isFile();
      })
      .map((entry) => entry.replace(/\.md$/, "")); // Remove .md extension

    return skills.sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * List all MCPs in a project's .claude/settings.json
 */
export function listProjectMcps(folderPath: string): string[] {
  try {
    const settingsPath = path.join(folderPath, ".claude", "settings.json");

    if (!fs.existsSync(settingsPath)) {
      return [];
    }

    const content = fs.readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(content);

    const mcpServers = settings.mcpServers || {};
    const mcps = Object.keys(mcpServers);

    return mcps.sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}
