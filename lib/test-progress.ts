/**
 * Checklist progress for a card face.
 *
 * The style contract in `lib/prompts/test-style.ts` caps the opening
 * `## Core flow` / `## Temel akış` group at five items and marks every later
 * group optional: if the core flow passes, the feature fundamentally works.
 * A flat count hides that — a card reading `1/46` looks like a day of work
 * when the part that matters is five steps long, and a checklist that reads
 * as work to postpone never gets run.
 *
 * So the core group is counted separately. Cards written before the contract
 * carry no such heading; `core` stays undefined for them and the face falls
 * back to the flat count rather than guessing which items are essential.
 */

export interface TestProgress {
  /** Every item in the checklist, whichever group it sits in. */
  checked: number;
  total: number;
  /** The `Core flow` group alone. Undefined when the checklist has no such heading. */
  core?: { checked: number; total: number };
}

/** Heading text that opens the core group, in either language the contract writes. */
const CORE_HEADING = /^(core\s*flow|temel\s*ak[ıi][şs])$/;

const H2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;

function countChecks(html: string): { checked: number; total: number } {
  const checked = (html.match(/data-checked="true"/g) || []).length;
  const unchecked = (html.match(/data-checked="false"/g) || []).length;
  return { checked, total: checked + unchecked };
}

/** Heading label without markup, casing, or stray whitespace. */
function normalizeHeading(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The markup between the core heading and the next `<h2>` (or the end of the
 * checklist when it is the only group).
 */
function findCoreSection(html: string): string | null {
  const headings: { label: string; bodyStart: number }[] = [];

  H2.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = H2.exec(html)) !== null) {
    headings.push({
      label: normalizeHeading(match[1]),
      bodyStart: match.index + match[0].length,
    });
  }

  const index = headings.findIndex((h) => CORE_HEADING.test(h.label));
  if (index === -1) return null;

  const next = headings[index + 1];
  // A following heading ends the section; slice up to where its markup begins,
  // which is the end of this section's body.
  const end = next ? html.lastIndexOf("<h2", next.bodyStart) : html.length;
  return html.slice(headings[index].bodyStart, end);
}

export function parseTestProgress(html: string): TestProgress | null {
  if (!html) return null;

  const overall = countChecks(html);
  if (overall.total === 0) return null;

  const coreSection = findCoreSection(html);
  if (!coreSection) return overall;

  const core = countChecks(coreSection);
  // A heading with nothing under it says less than the flat count does.
  if (core.total === 0) return overall;

  return { ...overall, core };
}
