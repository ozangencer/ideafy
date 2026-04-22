import fs from "node:fs";
import path from "node:path";
import type { AiPlatform, SkillListItem, SkillSource } from "@/lib/types";
import { parseSkillDocument } from "./frontmatter";

type GroupOverrides = Map<string, string>;

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
    const metadata = parseSkillDocument(content, skillName);

    return {
      name: skillName,
      title: metadata.displayTitle,
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
