type FrontmatterParseResult = {
  frontmatter: Record<string, string>;
  bodyContent: string;
  rawContent: string;
};

export type ParsedSkillDocument = {
  frontmatter: Record<string, string>;
  rawContent: string;
  bodyContent: string;
  displayTitle: string;
  listTitle: string;
  description: string | null;
  group: string | null;
  firstHeading: string | null;
};

export function humanizeSkillName(name: string): string {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function parseSimpleFrontmatter(content: string): FrontmatterParseResult {
  if (!content.startsWith("---\n")) {
    return {
      frontmatter: {},
      bodyContent: content,
      rawContent: content,
    };
  }

  const endIndex = content.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return {
      frontmatter: {},
      bodyContent: content,
      rawContent: content,
    };
  }

  const frontmatterBlock = content.slice(4, endIndex);
  const bodyContent = content.slice(endIndex + 5);
  const frontmatter: Record<string, string> = {};
  const lines = frontmatterBlock.split("\n");

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
        frontmatter[key] = value;
      }
      continue;
    }

    const value = rawValue.replace(/^['"]|['"]$/g, "").trim();
    if (value) {
      frontmatter[key] = value;
    }
  }

  return {
    frontmatter,
    bodyContent,
    rawContent: content,
  };
}

function extractFirstHeading(bodyContent: string): { heading: string | null; bodyWithoutHeading: string } {
  const headingMatch = bodyContent.match(/^(\s*)#\s+(.+)$/m);
  if (!headingMatch) {
    return { heading: null, bodyWithoutHeading: bodyContent };
  }

  const heading = headingMatch[2].trim();
  const headingIndex = headingMatch.index ?? -1;

  // Remove the heading from body only if it is the first meaningful line.
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

export function parseSkillDocument(
  rawContent: string,
  skillName: string
): ParsedSkillDocument {
  const { frontmatter, bodyContent } = parseSimpleFrontmatter(rawContent);
  const { heading, bodyWithoutHeading } = extractFirstHeading(bodyContent);

  const metadataTitle =
    frontmatter.title ||
    frontmatter.name ||
    humanizeSkillName(skillName);

  return {
    frontmatter,
    rawContent,
    bodyContent: bodyWithoutHeading,
    displayTitle: heading || metadataTitle,
    listTitle: metadataTitle,
    description:
      frontmatter.description ||
      frontmatter.summary ||
      frontmatter.subtitle ||
      null,
    group: frontmatter.group || frontmatter.category || null,
    firstHeading: heading,
  };
}
