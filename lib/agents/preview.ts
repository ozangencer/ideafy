import type { AgentFormat } from "@/lib/types";
import {
  humanizeSkillName,
  parseSimpleFrontmatter,
} from "@/lib/skills/frontmatter";

export type ParsedAgentDocument = {
  frontmatter: Record<string, string>;
  rawContent: string;
  bodyContent: string;
  displayTitle: string;
  description: string | null;
  firstHeading: string | null;
};

function extractFirstHeading(bodyContent: string): {
  heading: string | null;
  bodyWithoutHeading: string;
} {
  const headingMatch = bodyContent.match(/^(\s*)#\s+(.+)$/m);
  if (!headingMatch) {
    return { heading: null, bodyWithoutHeading: bodyContent };
  }

  const heading = headingMatch[2].trim();
  const headingIndex = headingMatch.index ?? -1;
  const leadingSegment = bodyContent.slice(0, headingIndex);
  const isLeadingHeading = leadingSegment.trim() === "";

  if (!isLeadingHeading) {
    return { heading, bodyWithoutHeading: bodyContent };
  }

  const bodyWithoutHeading = bodyContent
    .slice(headingIndex + headingMatch[0].length)
    .replace(/^\s+/, "");

  return { heading, bodyWithoutHeading };
}

function parseTomlFrontmatter(rawContent: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  const matches = Array.from(
    rawContent.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*["']([\s\S]*?)["']\s*$/gm)
  );

  for (const match of matches) {
    const key = match[1]?.trim().toLowerCase();
    const value = match[2]?.trim();
    if (!key || !value) continue;
    metadata[key] = value;
  }

  return metadata;
}

export function parseAgentDocument(
  rawContent: string,
  agentName: string,
  format: AgentFormat
): ParsedAgentDocument {
  if (format === "toml") {
    const frontmatter = parseTomlFrontmatter(rawContent);
    return {
      frontmatter,
      rawContent,
      bodyContent: `\`\`\`toml\n${rawContent.trim()}\n\`\`\``,
      displayTitle: frontmatter.title || frontmatter.name || humanizeSkillName(agentName),
      description: frontmatter.description || null,
      firstHeading: null,
    };
  }

  const { frontmatter, bodyContent } = parseSimpleFrontmatter(rawContent);
  const { heading, bodyWithoutHeading } = extractFirstHeading(bodyContent);

  return {
    frontmatter,
    rawContent,
    bodyContent: bodyWithoutHeading,
    displayTitle:
      heading || frontmatter.title || frontmatter.name || humanizeSkillName(agentName),
    description:
      frontmatter.description || frontmatter.summary || frontmatter.subtitle || null,
    firstHeading: heading,
  };
}
