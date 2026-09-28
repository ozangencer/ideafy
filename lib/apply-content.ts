/**
 * Pick the part of an assistant chat reply that should land on the card when
 * the user clicks Append / Replace. Client-safe: no fs, no platform imports.
 *
 * A reply usually wraps the content in narration — "reading the opinion…",
 * "here's the revised plan, apply it with Replace:" — that belongs in the
 * chat, not in the card field. Resolution order:
 *   1. An explicit `<!-- ideafy:apply -->` … `<!-- /ideafy:apply -->` block
 *      (the last one wins; a missing close tag runs to the end).
 *   2. Otherwise everything from the first markdown heading on — or, in the
 *      Tests section, from the first heading or checkbox line. A short plain
 *      closing remark after a final `---` ("want me to open the Phase 2
 *      card?") is dropped too: it is the same narration, just at the end.
 *   3. Otherwise the whole reply, unchanged. A short "reword that paragraph"
 *      answer has no heading, and trimming it would lose content.
 * The trailing "click Append or Replace" sign-off is stripped in every case.
 */

import type { SectionType } from "@/lib/types";

export const APPLY_OPEN_MARKER = "<!-- ideafy:apply -->";
export const APPLY_CLOSE_MARKER = "<!-- /ideafy:apply -->";

const OPEN_RE = /<!--\s*ideafy:apply\s*-->/gi;
const CLOSE_RE = /<!--\s*\/ideafy:apply\s*-->/i;
const ANY_MARKER_RE = /<!--\s*\/?ideafy:apply\s*-->/gi;

export interface ApplicableContent {
  content: string;
  /** True when narration before the content was dropped. */
  trimmedIntro: boolean;
  /** True when a closing remark after the last `---` was dropped. */
  trimmedOutro: boolean;
  /** First heading of the extracted content, for the confirm dialog. */
  firstHeading: string | null;
}

// Strip trailing assistant sign-off paragraphs that tell the user to click
// Append/Replace. These are meta-instructions about the UI, not content the
// user wants persisted into the card field.
export function stripApplySignoff(content: string): string {
  let text = content.replace(/\s+$/, "");
  // Repeatedly peel the last paragraph as long as it looks like a meta sign-off.
  for (let i = 0; i < 3; i++) {
    const match = text.match(/(^|\n\n)([^\n][^\n]*?)$/);
    if (!match) break;
    const lastPara = match[2];
    const mentionsApply =
      /\bAppend\b/i.test(lastPara) && /\bReplace\b/i.test(lastPara);
    if (!mentionsApply) break;
    text = text.slice(0, match.index!).replace(/\s+$/, "");
  }
  return text;
}

/** True when the reply fences content for Apply with an explicit marker. */
export function hasApplyBlock(content: string): boolean {
  return /<!--\s*ideafy:apply\s*-->/i.test(content);
}

function extractMarkedBlock(content: string): string | null {
  let lastOpenEnd = -1;
  for (const m of Array.from(content.matchAll(OPEN_RE))) {
    lastOpenEnd = m.index! + m[0].length;
  }
  if (lastOpenEnd === -1) return null;
  const rest = content.slice(lastOpenEnd);
  const close = rest.match(CLOSE_RE);
  return close ? rest.slice(0, close.index) : rest;
}

// Index of the first line that starts the content proper, skipping anything
// inside fenced code blocks so a `# comment` in a snippet isn't mistaken for
// a heading.
function findContentStart(content: string, sectionType: SectionType): number {
  const lines = content.split("\n");
  let offset = 0;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
    } else if (!inFence) {
      const isHeading = /^\s{0,3}#{1,6}\s+\S/.test(line);
      const isCheckbox = sectionType === "tests" && /^\s*[-*]\s*\[[ xX]\]/.test(line);
      if (isHeading || isCheckbox) return offset;
    }
    offset += line.length + 1;
  }
  return -1;
}

const THEMATIC_BREAK_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
// Anything structured means the tail is content, not a remark: headings,
// list items, fences, tables, and the [COMPLEXITY:] / [PRIORITY:] markers a
// plan may park below a divider.
const STRUCTURED_LINE_RE = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|```|~~~|\||\[[A-Z_]+:)/;
const OUTRO_MAX_CHARS = 400;
const OUTRO_MAX_PARAGRAPHS = 2;

// Drop a closing remark that sits after the content's last `---`. Only short,
// unstructured prose qualifies: a divider followed by another section, a list
// or the plan markers stays, and so does a divider inside a code fence.
function stripTrailingOutro(content: string): { text: string; trimmed: boolean } {
  const lines = content.split("\n");
  let breakLine = -1;
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    // A `---` right under a text line is a setext heading underline, not a divider.
    else if (!inFence && THEMATIC_BREAK_RE.test(line) && (i === 0 || !lines[i - 1].trim())) {
      breakLine = i;
    }
  });
  if (breakLine === -1) return { text: content, trimmed: false };

  const tail = lines.slice(breakLine + 1).join("\n").trim();
  const isRemark =
    tail.length <= OUTRO_MAX_CHARS &&
    tail.split(/\n\s*\n/).length <= OUTRO_MAX_PARAGRAPHS &&
    !tail.split("\n").some((line) => STRUCTURED_LINE_RE.test(line));
  if (tail && !isRemark) return { text: content, trimmed: false };

  return { text: lines.slice(0, breakLine).join("\n").trimEnd(), trimmed: Boolean(tail) };
}

function firstHeadingOf(content: string): string | null {
  const match = content.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
  return match ? match[1].replace(/[*_`]/g, "").trim() : null;
}

export function extractApplicableContent(
  content: string,
  sectionType: SectionType,
): ApplicableContent {
  const marked = extractMarkedBlock(content);
  if (marked !== null && marked.trim()) {
    const body = stripApplySignoff(marked.trim());
    // A block that opens at the reply's first line hid no narration.
    const trimmedIntro = content.slice(0, content.search(OPEN_RE)).trim().length > 0;
    return { content: body, trimmedIntro, trimmedOutro: false, firstHeading: firstHeadingOf(body) };
  }

  // An empty block is no signal; drop its stray markers and fall through.
  if (marked !== null) content = content.replace(ANY_MARKER_RE, "");

  // A reply that opens with its heading has no intro to drop, but can still
  // close with a remark, so the outro pass runs whenever there is a heading.
  const start = findContentStart(content, sectionType);
  if (start >= 0) {
    const outro = stripTrailingOutro(content.slice(start).trim());
    const body = stripApplySignoff(outro.text);
    return {
      content: body,
      trimmedIntro: content.slice(0, start).trim().length > 0,
      trimmedOutro: outro.trimmed,
      firstHeading: firstHeadingOf(body),
    };
  }

  const body = stripApplySignoff(content);
  return { content: body, trimmedIntro: false, trimmedOutro: false, firstHeading: firstHeadingOf(body) };
}
