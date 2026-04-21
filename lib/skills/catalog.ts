import fs from "node:fs";
import path from "node:path";
import type { AiPlatform, SkillListItem, SkillSource } from "@/lib/types";

type SkillMetadata = {
  title: string;
  group: string | null;
  description: string | null;
};

type GroupOverrides = Map<string, string>;

function parseSimpleFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---\n")) return {};

  const endIndex = content.indexOf("\n---\n", 4);
  if (endIndex === -1) return {};

  const frontmatter = content.slice(4, endIndex);
  const result: Record<string, string> = {};

  const lines = frontmatter.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const rawValue = line.slice(separatorIndex + 1).trim();

    if (!key) continue;

    if (rawValue === ">" || rawValue === ">-" || rawValue === "|" || rawValue === "|-") {
      const blockLines: string[] = [];
      const foldLines = rawValue.startsWith(">");

      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        if (!nextLine.startsWith(" ") && !nextLine.startsWith("\t")) break;
        blockLines.push(nextLine.trim());
        index += 1;
      }

      const value = foldLines
        ? blockLines.join(" ").replace(/\s+/g, " ").trim()
        : blockLines.join("\n").trim();

      if (value) {
        result[key] = value;
      }
      continue;
    }

    const value = rawValue.replace(/^['"]|['"]$/g, "").trim();
    if (value) {
      result[key] = value;
    }
  }

  return result;
}

function humanizeSkillName(name: string): string {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseSkillMetadata(content: string, skillName: string): SkillMetadata {
  const frontmatter = parseSimpleFrontmatter(content);

  const headingMatch = content.match(/^#\s+(.+)$/m);
  const title =
    frontmatter.title ||
    (headingMatch ? headingMatch[1].trim() : "") ||
    humanizeSkillName(skillName);

  const description =
    frontmatter.description ||
    frontmatter.summary ||
    frontmatter.subtitle ||
    null;

  return {
    title,
    group: frontmatter.group || frontmatter.category || null,
    description,
  };
}

function readGroupOverrides(rootDir: string): GroupOverrides {
  const overrides = new Map<string, string>();
  const configPath = path.join(rootDir, ".ideafy-groups.json");

  if (!fs.existsSync(configPath)) return overrides;

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return overrides;
    }

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        overrides.set(key, value);
        continue;
      }

      if (Array.isArray(value)) {
        for (const skillName of value) {
          if (typeof skillName === "string" && skillName.trim()) {
            overrides.set(skillName, key);
          }
        }
      }
    }
  } catch {
    return overrides;
  }

  return overrides;
}

function createSkillItem(
  filePath: string,
  skillName: string,
  source: SkillSource,
  groupOverrides: GroupOverrides
): SkillListItem | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const metadata = parseSkillMetadata(content, skillName);

    return {
      name: skillName,
      title: metadata.title,
      path: path.resolve(filePath),
      group: metadata.group || groupOverrides.get(skillName) || null,
      description: metadata.description,
      source,
    };
  } catch {
    return null;
  }
}

function scanFlatMarkdownSkills(
  rootDir: string,
  source: SkillSource
): SkillListItem[] {
  if (!fs.existsSync(rootDir)) return [];
  const groupOverrides = readGroupOverrides(rootDir);

  return fs
    .readdirSync(rootDir)
    .filter((entry) => {
      if (entry.startsWith(".")) return false;
      if (!entry.endsWith(".md")) return false;
      return fs.statSync(path.join(rootDir, entry)).isFile();
    })
    .map((entry) =>
      createSkillItem(
        path.join(rootDir, entry),
        entry.replace(/\.md$/i, ""),
        source,
        groupOverrides
      )
    )
    .filter((item): item is SkillListItem => item !== null);
}

function scanDirectorySkills(
  rootDir: string,
  source: SkillSource
): SkillListItem[] {
  if (!fs.existsSync(rootDir)) return [];
  const groupOverrides = readGroupOverrides(rootDir);

  return fs
    .readdirSync(rootDir)
    .filter((entry) => {
      if (entry.startsWith(".")) return false;
      const entryPath = path.join(rootDir, entry);
      return fs.statSync(entryPath).isDirectory();
    })
    .map((entry) =>
      createSkillItem(
        path.join(rootDir, entry, "SKILL.md"),
        entry,
        source,
        groupOverrides
      )
    )
    .filter((item): item is SkillListItem => item !== null);
}

function dedupeSkillItems(items: SkillListItem[]): SkillListItem[] {
  const deduped = new Map<string, SkillListItem>();

  for (const item of items) {
    deduped.set(item.name, item);
  }

  return Array.from(deduped.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

export function listGlobalSkillItems(skillsRoot: string): SkillListItem[] {
  return dedupeSkillItems([
    ...scanDirectorySkills(skillsRoot, "global"),
    ...scanFlatMarkdownSkills(skillsRoot, "global"),
  ]);
}

export function listProjectSkillItems(
  folderPath: string,
  platform: AiPlatform
): SkillListItem[] {
  const items: SkillListItem[] = [];

  if (platform === "claude") {
    items.push(
      ...scanFlatMarkdownSkills(path.join(folderPath, ".claude", "commands"), "project")
    );
    items.push(
      ...scanDirectorySkills(path.join(folderPath, ".claude", "skills"), "project")
    );
  }

  if (platform === "gemini") {
    items.push(
      ...scanDirectorySkills(path.join(folderPath, ".gemini", "skills"), "project")
    );
  }

  if (platform === "codex") {
    items.push(
      ...scanDirectorySkills(path.join(folderPath, ".agents", "skills"), "project")
    );
  }

  return dedupeSkillItems(items);
}
