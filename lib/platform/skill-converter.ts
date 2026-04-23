/**
 * Converts Claude skill format (allowed-tools, argument-hint, description)
 * to the open Agent Skills SKILL.md format (name, description) used by
 * Gemini CLI and Codex CLI.
 */
import * as fs from "fs";
import * as path from "path";
import { resolveUserSkillsDir } from "../paths";

// User-writable skills dir — in packaged mode this is userData/skills (mirror
// of the bundled skills on first boot, editable afterwards); in dev it's
// the repo's skills/ directory.
const SKILLS_DIR = resolveUserSkillsDir();

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

const CODEX_GENERATED_MARKER = "<!-- ideafy-codex-skill:v1 -->";

const CODEX_SKILLS: Record<string, { description: string; body: string }> = {
  ideafy: {
    description: "Use when managing Ideafy kanban cards with the local Ideafy MCP tools.",
    body: `# Ideafy Card Management

Use the Ideafy MCP tools to list, create, update, and move cards for the current project.

## Workflow

1. Resolve the current project first by calling \`mcp__ideafy__get_project_by_folder\` with the current working directory.
2. If the project is not found, stop and tell the user the response message.
3. For card operations, prefer the project's display ID when talking to the user, but use the UUID returned by MCP tools for updates.
4. Keep responses concise and use the user's language.

## Common Actions

- List cards: call \`mcp__ideafy__list_cards\` with the resolved \`projectId\`.
- Show a card: call \`mcp__ideafy__get_card\` with a UUID, display ID, or task number.
- Create a card: call \`mcp__ideafy__create_card\` with a title, projectId, and any provided description, priority, complexity, or status.
- Update a card: call \`mcp__ideafy__update_card\` only for fields the user explicitly asked to change.
- Move a card: call \`mcp__ideafy__move_card\` with one of \`ideation\`, \`backlog\`, \`bugs\`, \`progress\`, \`test\`, \`completed\`, or \`withdrawn\`.
- Save a plan: call \`mcp__ideafy__save_plan\`; it moves the card to In Progress.
- Save tests: call \`mcp__ideafy__save_tests\`; it moves the card to Human Test.
- Save an opinion: call \`mcp__ideafy__save_opinion\`.

When a request is ambiguous, ask one short clarifying question before changing cards.`,
  },
  "human-test": {
    description: "Use when turning completed work into an Ideafy Human Test card with test scenarios.",
    body: `# Human Test Card Creator

Create or update an Ideafy card so completed work can be manually tested.

## Workflow

1. Resolve the current project with \`mcp__ideafy__get_project_by_folder\`.
2. If the project is not found, stop and tell the user the response message.
3. Summarize the work into a title, description, solution summary, priority, and complexity.
4. Create the card with \`mcp__ideafy__create_card\` using status \`progress\`.
5. Add manual test scenarios with \`mcp__ideafy__save_tests\`.

## Test Format

Use markdown checkboxes grouped under headings:

\`\`\`markdown
## Test Scenarios

### Happy Path
- [ ] Verify the main workflow and expected result

### Edge Cases
- [ ] Verify an important edge case

### Regression
- [ ] Verify an existing behavior still works
\`\`\`

Every test item must start with \`- [ ]\`. Include functional checks, edge cases, and regressions.`,
  },
  "product-narrative": {
    description: "Use when helping write or refine an Ideafy product narrative for a project.",
    body: `# Product Narrative

Help the user create a focused product narrative that gives future coding sessions useful context.

## Output

Write a concise markdown document covering:

- Product purpose
- Target user
- Core workflows
- Non-goals
- Design and technical constraints
- Current priorities

Prefer direct product language over marketing language. If important context is missing, ask a small number of focused questions before writing the narrative.`,
  },
};

export function convertSkillToCodexSkillMd(skillName: string): string {
  const skill = CODEX_SKILLS[skillName];
  if (!skill) return convertSkillToSkillMd(skillName);

  return `---\nname: ${skillName}\ndescription: ${skill.description}\n---\n${CODEX_GENERATED_MARKER}\n\n${skill.body}\n`;
}

export function isGeneratedCodexSkill(content: string): boolean {
  return content.includes(CODEX_GENERATED_MARKER);
}

export function isLegacyConvertedSkill(content: string): boolean {
  return content.includes("$ARGUMENTS") || content.includes("Claude Code");
}
