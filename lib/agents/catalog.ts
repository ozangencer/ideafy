import fs from "node:fs";
import path from "node:path";
import type { AgentListItem, AiPlatform, SkillSource } from "@/lib/types";
import { humanizeSkillName, parseSimpleFrontmatter } from "@/lib/skills/frontmatter";

function isSupportedAgentFile(filePath: string): boolean {
  return filePath.endsWith(".md") || filePath.endsWith(".toml");
}

function parseTomlDescription(content: string): string | null {
  const descriptionMatch = content.match(/^\s*description\s*=\s*["']([\s\S]*?)["']\s*$/m);
  return descriptionMatch?.[1]?.trim() || null;
}

function toAgentItem(
  filePath: string,
  source: SkillSource
): AgentListItem | null {
  if (!isSupportedAgentFile(filePath)) return null;

  const extension = path.extname(filePath).toLowerCase();
  const format = extension === ".toml" ? "toml" : "md";
  const name = path.basename(filePath, extension);

  let title = humanizeSkillName(name);
  let description: string | null = null;

  try {
    const rawContent = fs.readFileSync(filePath, "utf-8");
    if (format === "md") {
      const { frontmatter } = parseSimpleFrontmatter(rawContent);
      title = frontmatter.title || frontmatter.name || title;
      description =
        frontmatter.description ||
        frontmatter.summary ||
        frontmatter.subtitle ||
        null;
    } else {
      description = parseTomlDescription(rawContent);
    }
  } catch {
    return null;
  }

  return {
    name,
    title,
    path: filePath,
    description,
    source,
    format,
  };
}

function scanAgentDirectory(
  directoryPath: string,
  source: SkillSource
): AgentListItem[] {
  if (!fs.existsSync(directoryPath)) return [];

  return fs
    .readdirSync(directoryPath)
    .filter((entry) => !entry.startsWith("."))
    .map((entry) => path.join(directoryPath, entry))
    .filter((entryPath) => fs.existsSync(entryPath) && fs.statSync(entryPath).isFile())
    .map((entryPath) => toAgentItem(entryPath, source))
    .filter((item): item is AgentListItem => item !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listGlobalAgentItems(agentsPath: string): AgentListItem[] {
  return scanAgentDirectory(agentsPath, "global");
}

export function listProjectAgentItems(
  folderPath: string,
  platformId: AiPlatform
): AgentListItem[] {
  let directoryPath: string;

  switch (platformId) {
    case "claude":
      directoryPath = path.join(folderPath, ".claude", "agents");
      break;
    case "gemini":
      directoryPath = path.join(folderPath, ".gemini", "agents");
      break;
    case "codex":
      directoryPath = path.join(folderPath, ".codex", "agents");
      break;
    default:
      return [];
  }

  return scanAgentDirectory(directoryPath, "project");
}
