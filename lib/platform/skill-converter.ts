/**
 * Converts Claude skill format (allowed-tools, argument-hint, description)
 * to the open Agent Skills SKILL.md format (name, description) used by
 * Gemini CLI and Codex CLI.
 */
import * as fs from "fs";
import * as path from "path";

const SKILLS_DIR = path.resolve(process.cwd(), "skills");

export const SKILL_FILES = ["human-test.md", "product-narrative.md", "ideafy.md"];

/**
 * Read a Claude-format skill file and convert it to SKILL.md format.
 * Strips Claude-specific frontmatter keys (allowed-tools, argument-hint)
 * and keeps only name + description in the YAML frontmatter.
 */
export function convertSkillToSkillMd(skillName: string): string {
  const content = fs.readFileSync(path.join(SKILLS_DIR, `${skillName}.md`), "utf-8");

  // Parse frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return content;

  const frontmatter = fmMatch[1];
  const body = fmMatch[2];

  // Extract description from frontmatter
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  const description = descMatch ? descMatch[1].trim() : skillName;

  // Build SKILL.md format frontmatter (only name + description)
  const newFrontmatter = `---\nname: ${skillName}\ndescription: ${description}\n---`;

  return `${newFrontmatter}\n${body}`;
}
