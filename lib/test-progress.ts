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
 *
 * Pre-verify reads the same split one step further: once the core flow is
 * ticked it moves on to the next group with unticked items, by whatever
 * heading that group carries — the contract lets a card name its own groups.
 */

export interface TestProgress {
  /** Every item in the checklist, whichever group it sits in. */
  checked: number;
  total: number;
  /** The `Core flow` group alone. Undefined when the checklist has no such heading. */
  core?: { checked: number; total: number };
  /**
   * Every `<h2>` group with at least one item, in checklist order. Items above
   * the first heading belong to no group: no pre-verify ever targets them.
   */
  groups: TestGroup[];
}

/** One `## Heading` of the checklist and the items under it. */
export interface TestGroup {
  /** The heading as written — casing kept, since a button shows it. */
  heading: string;
  /**
   * 1-based count of groups so far with this same heading. Two `## Regression`
   * groups are told apart by it when a run is pointed at one of them.
   */
  occurrence: number;
  /** The core flow group, the one Pre-verify always starts with. */
  core: boolean;
  checked: number;
  total: number;
}

/**
 * What a pre-verify run covers: the next group with unticked items, or every
 * group from there on. The default everywhere is `next`; `all` is only ever an
 * explicit choice.
 */
export type VerifyScope = "next" | "all";

export function isVerifyScope(value: unknown): value is VerifyScope {
  return value === "next" || value === "all";
}

/** Heading text that opens the core group, in either language the contract writes. */
const CORE_HEADING = /^(core\s*flow|temel\s*ak[ıi][şs])$/;

const H2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;

function countChecks(html: string): { checked: number; total: number } {
  const checked = (html.match(/data-checked="true"/g) || []).length;
  const unchecked = (html.match(/data-checked="false"/g) || []).length;
  return { checked, total: checked + unchecked };
}

/** Heading text as written: no markup, no `#`, single spaces. */
function headingText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Section {
  heading: string;
  /** Lower-cased heading, for matching. */
  label: string;
  body: string;
}

/**
 * Every `<h2>` and the markup up to the next one (or the end of the
 * checklist for the last group).
 */
function splitSections(html: string): Section[] {
  const headings: { heading: string; bodyStart: number }[] = [];

  H2.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = H2.exec(html)) !== null) {
    headings.push({
      heading: headingText(match[1]),
      bodyStart: match.index + match[0].length,
    });
  }

  return headings.map((h, index) => {
    const next = headings[index + 1];
    // A following heading ends the section; slice up to where its markup
    // begins, which is the end of this section's body.
    const end = next ? html.lastIndexOf("<h2", next.bodyStart) : html.length;
    return { heading: h.heading, label: h.heading.toLowerCase(), body: html.slice(h.bodyStart, end) };
  });
}

export function parseTestProgress(html: string): TestProgress | null {
  if (!html) return null;

  const overall = countChecks(html);
  if (overall.total === 0) return null;

  const sections = splitSections(html);
  const coreIndex = sections.findIndex((s) => CORE_HEADING.test(s.label));
  const seen = new Map<string, number>();
  const groups: TestGroup[] = [];
  sections.forEach((section, index) => {
    const occurrence = (seen.get(section.label) ?? 0) + 1;
    seen.set(section.label, occurrence);
    const counts = countChecks(section.body);
    if (counts.total === 0) return;
    groups.push({ heading: section.heading, occurrence, core: index === coreIndex, ...counts });
  });

  const core = groups.find((g) => g.core);
  // A heading with nothing under it says less than the flat count does.
  if (!core) return { ...overall, groups };

  return { ...overall, core: { checked: core.checked, total: core.total }, groups };
}

/**
 * The groups a pre-verify run covers, in checklist order. The core flow comes
 * first while it has unticked items; after that, the first later group that
 * still has some. `all` takes that group and every later one with unticked
 * items. Groups above the core heading are never targeted, and neither is
 * anything in a checklist without one: there the agent cannot tell which
 * items are essential (IDE-287).
 */
export function verifyTargets(progress: TestProgress | null | undefined, scope: VerifyScope): TestGroup[] {
  if (!progress?.core) return [];
  const coreIndex = progress.groups.findIndex((g) => g.core);
  const open = progress.groups.slice(coreIndex).filter((g) => g.checked < g.total);
  return scope === "all" ? open : open.slice(0, 1);
}

/** The group the next Pre-verify press runs, or null when nothing is left to run. */
export function nextVerifyGroup(progress: TestProgress | null | undefined): TestGroup | null {
  return verifyTargets(progress, "next")[0] ?? null;
}

/**
 * Whether "All remaining groups" means anything beyond the next press: the
 * core flow is done and more than one later group still has unticked items.
 * While the core flow is open it always goes first on its own.
 */
export function canVerifyAllGroups(progress: TestProgress | null | undefined): boolean {
  const next = nextVerifyGroup(progress);
  return !!next && !next.core && verifyTargets(progress, "all").length > 1;
}

/** Unticked items across the groups, for sizing a run's time limit. */
export function untickedIn(groups: TestGroup[]): number {
  return groups.reduce((sum, g) => sum + (g.total - g.checked), 0);
}

/**
 * The contract's own group names, in both languages it writes checklists in.
 * The checklist follows the card's language; the app's chrome does not, so a
 * Turkish `## Kenar durumlar` still reads "Edge cases" on a button.
 */
const KNOWN_GROUP_LABELS: [RegExp, string][] = [
  [CORE_HEADING, "Core flow"],
  [/^(edge\s*cases?|kenar\s*durumlar[ıi]?)$/, "Edge cases"],
  [/^(regression(\s*tests?)?|regresyon(\s*testleri)?)$/, "Regression"],
];

/**
 * How the app's UI names a group. The contract's groups get their English
 * name; a heading the card chose for itself is shown as written. Prompts keep
 * using the heading itself (`describeTestGroup`) — the agent has to find it.
 */
export function testGroupLabel(group: TestGroup): string {
  const label = group.heading.toLowerCase();
  const known = KNOWN_GROUP_LABELS.find(([pattern]) => pattern.test(label));
  return known ? known[1] : group.heading;
}

/**
 * How a prompt names a group: its heading, plus which one when the same
 * heading appears more than once.
 */
export function describeTestGroup(group: TestGroup, groups: TestGroup[]): string {
  const repeated = groups.some((g) => g !== group && g.heading.toLowerCase() === group.heading.toLowerCase());
  if (!repeated) return `\`## ${group.heading}\``;
  return `the ${ordinal(group.occurrence)} \`## ${group.heading}\` group`;
}

function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th";
  return `${n}${suffix}`;
}
