import * as fs from "fs";
import * as path from "path";

/** List MCP server names declared in the project's `.claude/settings.json`. */
export function listProjectMcps(folderPath: string): string[] {
  try {
    const settingsPath = path.join(folderPath, ".claude", "settings.json");
    if (!fs.existsSync(settingsPath)) return [];
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    return Object.keys(settings.mcpServers || {}).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * List skill names available to a project. Combines two sources:
 * - `.claude/commands/*.md` (legacy flat layout)
 * - `.claude/skills/<name>/SKILL.md` (modern layout)
 */
export function listProjectSkills(folderPath: string): string[] {
  const skills = new Set<string>();

  // Legacy: .claude/commands/*.md
  try {
    const commandsDir = path.join(folderPath, ".claude", "commands");
    if (fs.existsSync(commandsDir)) {
      fs.readdirSync(commandsDir)
        .filter((entry) => {
          if (entry.startsWith(".")) return false;
          if (!entry.endsWith(".md")) return false;
          return fs.statSync(path.join(commandsDir, entry)).isFile();
        })
        .forEach((entry) => skills.add(entry.replace(/\.md$/, "")));
    }
  } catch {
    /* ignore */
  }

  // Modern: .claude/skills/<name>/SKILL.md
  try {
    const skillsDir = path.join(folderPath, ".claude", "skills");
    if (fs.existsSync(skillsDir)) {
      fs.readdirSync(skillsDir)
        .filter((entry) => {
          if (entry.startsWith(".")) return false;
          return fs.statSync(path.join(skillsDir, entry)).isDirectory();
        })
        .filter((entry) => fs.existsSync(path.join(skillsDir, entry, "SKILL.md")))
        .forEach((entry) => skills.add(entry));
    }
  } catch {
    /* ignore */
  }

  return Array.from(skills).sort((a, b) => a.localeCompare(b));
}

/** List agent names declared under `.claude/agents/*.md`. */
export function listProjectAgents(folderPath: string): string[] {
  try {
    const agentsDir = path.join(folderPath, ".claude", "agents");
    if (!fs.existsSync(agentsDir)) return [];
    return fs
      .readdirSync(agentsDir)
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
