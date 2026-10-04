import { marked } from "marked";

// Configure marked for Tiptap-compatible HTML
marked.setOptions({
  gfm: true,
  breaks: true,
});

function convertCheckboxListHtmlToTaskList(html: string): string {
  if (!html) return html;

  return html.replace(
    /<ul\b([^>]*)>\s*((?:<li\b[^>]*>\s*<input[^>]*type="checkbox"[^>]*>[\s\S]*?<\/li>\s*)+)<\/ul>/gi,
    (_match, attrs: string, items: string) => {
      if (/data-type\s*=\s*"taskList"/i.test(attrs)) {
        return `<ul${attrs}>${items}</ul>`;
      }

      const taskItems = items.replace(
        /<li\b([^>]*)>\s*<input([^>]*)type="checkbox"([^>]*)>\s*([\s\S]*?)<\/li>/gi,
        (
          _itemMatch: string,
          liAttrs: string,
          before: string,
          after: string,
          text: string
        ) => {
          if (/data-type\s*=\s*"taskItem"/i.test(liAttrs)) {
            return `<li${liAttrs}><input${before}type="checkbox"${after}>${text}</li>`;
          }
          const isChecked =
            /\bchecked\b/i.test(before) || /\bchecked\b/i.test(after);
          const trimmed = text.trim();
          const paragraph = /<p\b/i.test(trimmed) ? trimmed : `<p>${trimmed}</p>`;
          return `<li data-type="taskItem" data-checked="${isChecked}"><label><input type="checkbox"${isChecked ? ' checked="checked"' : ""}><span></span></label><div>${paragraph}</div></li>`;
        }
      );

      return `<ul data-type="taskList">${taskItems}</ul>`;
    }
  );
}

/**
 * Convert markdown to Tiptap-compatible HTML with TaskList support
 * Used for description, solutionSummary, and testScenarios fields
 */
export function markdownToTiptapHtml(markdown: string): string {
  if (!markdown || markdown.trim() === "") {
    return "";
  }

  // Convert with marked
  let html = marked.parse(markdown) as string;

  return convertCheckboxListHtmlToTaskList(html);
}

/**
 * Wrap the text of taskItems that carry no `<p>` in one. convertToTipTapTaskList
 * (the autonomous-run path) writes `<li data-type="taskItem" …>text</li>`, while
 * the editor writes `…<div><p>text</p></div></li>` — and extractTaskItems /
 * mergeTestCheckState only read the latter. Without this every verify run's
 * checklist read as empty and was refused (IDE-324).
 */
function wrapBareTaskItems(html: string): string {
  return html.replace(
    /(<li\b[^>]*data-type="taskItem"[^>]*>)([\s\S]*?)(<\/li>)/gi,
    (match, open: string, body: string, close: string) => {
      if (/<(p|ul|ol)\b/i.test(body)) return match;
      const trimmed = body.trim();
      return trimmed ? `${open}<p>${trimmed}</p>${close}` : match;
    }
  );
}

/**
 * Promote plain `<ul><li>…</li></ul>` content to Tiptap taskList (all items
 * unchecked). Apply before reading/merging test-scenario HTML so callers that
 * only know the taskItem schema (extractTaskItems, mergeTestCheckState) can
 * still see items produced by markdown without `- [ ]` prefixes or by older
 * writes that stored plain lists. Idempotent: lists already tagged
 * `data-type="taskList"` (or containing any taskItem child) are left alone.
 */
export function normalizeTestsHtml(html: string): string {
  if (!html) return html;
  return wrapBareTaskItems(convertCheckboxListHtmlToTaskList(html)).replace(
    /<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi,
    (match, attrs: string, inner: string) => {
      if (/data-type\s*=\s*"taskList"/i.test(attrs)) return match;
      if (/<li[^>]*data-type="taskItem"/i.test(inner)) return match;
      if (!/<li\b/i.test(inner)) return match;
      const taskItems = inner.replace(
        /<li\b[^>]*>([\s\S]*?)<\/li>/gi,
        (_m: string, body: string) => {
          const trimmed = body.trim();
          const paragraph = /<p\b/i.test(trimmed)
            ? trimmed
            : `<p>${trimmed}</p>`;
          return `<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div>${paragraph}</div></li>`;
        }
      );
      return `<ul data-type="taskList">${taskItems}</ul>`;
    }
  );
}

/**
 * Normalize task item text so minor rewording (casing, punctuation, whitespace,
 * trailing words) doesn't break checkbox-state preservation on merge.
 */
function normalizeTaskText(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .toLowerCase()
    // Blacklist common punctuation but keep letters (incl. Turkish) and digits.
    // Avoids `\p{L}` which requires the `u` flag / ES6 target.
    .replace(/[.,;:!?/\\|()[\]{}<>@#$%^&*"'`~=+\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;

  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function tokenize(s: string): string[] {
  return s.split(" ").filter((t) => t.length >= 3);
}

function tokenOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  let intersect = 0;
  for (const t of b) if (setA.has(t)) intersect++;
  return intersect / Math.max(a.length, b.length);
}

/**
 * Return an existing-item key whose normalized text is "close enough" to `target`.
 * Strategies in order: exact → substring containment → bounded Levenshtein →
 * token-overlap (Jaccard-like) ≥ 0.6. The last one rescues rewordings that
 * insert/replace a couple of non-keyword words but preserve the core terms.
 */
function findFuzzyMatch(target: string, candidates: string[]): string | null {
  if (candidates.includes(target)) return target;

  for (const c of candidates) {
    if (c.length < 6 || target.length < 6) continue;
    if (c.includes(target) || target.includes(c)) return c;
  }

  let best: { key: string; score: number } | null = null;
  const targetTokens = tokenize(target);

  for (const c of candidates) {
    const maxLen = Math.max(c.length, target.length);
    if (maxLen < 6) continue;

    const cap = Math.max(2, Math.floor(maxLen * 0.2));
    const d = levenshtein(target, c, cap);
    if (d <= cap) {
      const score = 1 - d / maxLen;
      if (!best || score > best.score) best = { key: c, score };
      continue;
    }

    const overlap = tokenOverlap(targetTokens, tokenize(c));
    if (overlap >= 0.6) {
      if (!best || overlap > best.score) best = { key: c, score: overlap };
    }
  }
  return best?.key ?? null;
}

/**
 * A taskItem's opening `<li`, whichever order its attributes come in. The
 * editor saves `data-checked` first, convertToTipTapTaskList writes
 * `data-type` first; a regex expecting one order read the other as an empty
 * checklist, so a verify run's write-back never saw the person's own ticks.
 */
const TASK_ITEM_OPEN = String.raw`<li\b(?=[^>]*data-type="taskItem")`;

/** Groups: attributes up to `data-checked="`, the rest through `<p>`, the text, `</p>`. */
function taskItemCheckRegex(): RegExp {
  return new RegExp(String.raw`${TASK_ITEM_OPEN}([^>]*data-checked=")(?:true|false)("[^>]*>.*?<p>)(.*?)(<\/p>)`, "gi");
}

export interface TaskItemState {
  normalized: string;
  checked: boolean;
  rawText: string;
}

/**
 * Extract task item texts (with checked state) from Tiptap TaskList HTML.
 * Keyed by normalized text so merge matching is resilient to rewording.
 */
export function extractTaskItems(html: string): TaskItemState[] {
  const items: TaskItemState[] = [];
  const normalized = normalizeTestsHtml(html);
  const regex = new RegExp(String.raw`${TASK_ITEM_OPEN}[^>]*data-checked="(true|false)"[^>]*>.*?<p>(.*?)<\/p>`, "gi");
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const checked = match[1] === "true";
    const rawText = match[2].trim();
    const normalized = normalizeTaskText(rawText);
    if (normalized) {
      items.push({ normalized, checked, rawText });
    }
  }
  return items;
}

/**
 * The checklist item an agent named in free text, by the same fuzzy match the
 * merge uses, or null when it names nothing on the list. An agent quoting an
 * item rarely copies it to the letter.
 */
export function matchTaskItem(text: string, html: string): TaskItemState | null {
  const target = normalizeTaskText(text);
  if (!target) return null;
  const items = extractTaskItems(html);
  const key = findFuzzyMatch(target, items.map((i) => i.normalized));
  return key ? items.find((i) => i.normalized === key) ?? null : null;
}

/** Index of the candidate that names the same item as `text`, or -1. */
export function closestTaskText(text: string, candidates: string[]): number {
  const target = normalizeTaskText(text);
  if (!target) return -1;
  const keys = candidates.map(normalizeTaskText);
  const key = findFuzzyMatch(target, keys.filter(Boolean));
  return key ? keys.indexOf(key) : -1;
}

/**
 * Untick the named items and leave every other box as it is. The one write
 * that may take a tick away: a re-verify that saw an item break after an
 * automatic fix.
 */
export function untickTaskItems(html: string, itemTexts: string[]): string {
  // Each name resolves to its one closest item first: matching the other way
  // round, a short name would take down every item that contains it.
  const keys = extractTaskItems(html).map((i) => i.normalized);
  const hits = new Set(
    itemTexts
      .map((text) => normalizeTaskText(text))
      .filter(Boolean)
      .map((target) => findFuzzyMatch(target, keys))
      .filter((key): key is string => key !== null)
  );
  if (hits.size === 0) return html;
  return normalizeTestsHtml(html).replace(
    taskItemCheckRegex(),
    (fullMatch, prefix, middle, text, suffix) => {
      if (!hits.has(normalizeTaskText(text))) return fullMatch;
      return `<li${prefix}false${middle}${text}${suffix}`.replace(
        /<input type="checkbox"(?:\s+checked="checked")?>/,
        '<input type="checkbox">'
      );
    }
  );
}

/**
 * Count how many existing items have a fuzzy match in the new HTML.
 * Used by the shrink guard to decide whether a rewrite is safe.
 */
export function countRetainedItems(existingHtml: string, newHtml: string): { retained: number; existing: number } {
  const existing = extractTaskItems(existingHtml);
  const newItems = extractTaskItems(newHtml);
  if (!existing.length) return { retained: 0, existing: 0 };
  const newKeys = newItems.map((i) => i.normalized);
  let retained = 0;
  for (const e of existing) {
    if (findFuzzyMatch(e.normalized, newKeys)) retained++;
  }
  return { retained, existing: existing.length };
}

/**
 * Decide whether `newHtml` is a safe rewrite of `existingHtml` for test scenarios.
 * Returns `safe: false` when the new content would silently wipe or drastically
 * shrink the existing list, so callers can preserve existing state instead.
 *
 * Threshold: the new content must retain at least 50% of existing items (fuzzy match).
 * An empty new list against a non-empty existing list is always considered unsafe.
 */
export function assessTestRewrite(existingHtml: string, newHtml: string): {
  safe: boolean;
  reason?: string;
  retained: number;
  existing: number;
} {
  const existingItems = extractTaskItems(existingHtml);
  if (!existingItems.length) return { safe: true, retained: 0, existing: 0 };

  const newItems = extractTaskItems(newHtml);
  if (!newItems.length) {
    return {
      safe: false,
      reason: "new test scenarios are empty — refusing to wipe existing list",
      retained: 0,
      existing: existingItems.length,
    };
  }

  const { retained, existing } = countRetainedItems(existingHtml, newHtml);
  const ratio = retained / existing;
  if (ratio < 0.5) {
    return {
      safe: false,
      reason: `new content retains only ${retained}/${existing} existing items (< 50%)`,
      retained,
      existing,
    };
  }
  return { safe: true, retained, existing };
}

/**
 * Merge checked states from existing HTML into new HTML. Matching is fuzzy:
 * existing items whose normalized text matches a new item (exact, substring, or
 * bounded Levenshtein) preserve their `checked` state. Newly added items stay
 * unchecked; dropped items are dropped.
 *
 * Callers for test scenarios should pair this with `assessTestRewrite` to guard
 * against silent wipes; this function itself does no safety check so downstream
 * edits like manual form saves still work for any size of change.
 */
export function mergeTestCheckState(existingHtml: string, newHtml: string): string {
  if (!existingHtml || !newHtml) return newHtml;

  const existingItems = extractTaskItems(existingHtml);
  if (existingItems.length === 0) return normalizeTestsHtml(newHtml);

  const existingKeys = existingItems.map((i) => i.normalized);
  const checkedMap = new Map<string, boolean>();
  for (const item of existingItems) checkedMap.set(item.normalized, item.checked);

  return normalizeTestsHtml(newHtml).replace(
    taskItemCheckRegex(),
    (fullMatch, prefix, middle, text, suffix) => {
      const normalized = normalizeTaskText(text);
      if (!normalized) return fullMatch;
      const matchedKey = findFuzzyMatch(normalized, existingKeys);
      const wasChecked = matchedKey ? checkedMap.get(matchedKey) : false;
      if (wasChecked) {
        const result = `<li${prefix}true${middle}${text}${suffix}`;
        return result.replace(
          /<input type="checkbox"(?:\s+checked="checked")?>/,
          '<input type="checkbox" checked="checked">'
        );
      }
      return fullMatch;
    }
  );
}

/**
 * Union-merge a stale form write with the latest stored test scenarios.
 * Use when a client submits testScenarios with a stale `baseUpdatedAt`: the
 * form couldn't have seen items added after it loaded, so missing-from-form
 * items must be preserved. For items the form DOES know about, it may have
 * toggled the checkbox — adopt that state. Items present only in the form
 * are appended at the end (rare: user manually added while offline).
 */
export function mergeStaleTestWrite(existingHtml: string, formHtml: string): string {
  const existingItems = extractTaskItems(existingHtml);
  if (existingItems.length === 0) return normalizeTestsHtml(formHtml);
  if (!formHtml) return existingHtml;

  const formItems = extractTaskItems(formHtml);
  const formKeys = formItems.map((i) => i.normalized);
  const formByKey = new Map(formItems.map((i) => [i.normalized, i] as const));

  const existingNormalized = normalizeTestsHtml(existingHtml);

  const updatedExisting = existingNormalized.replace(
    taskItemCheckRegex(),
    (fullMatch, prefix, middle, text, suffix) => {
      const normalized = normalizeTaskText(text);
      if (!normalized) return fullMatch;
      const matchedKey = findFuzzyMatch(normalized, formKeys);
      if (!matchedKey) return fullMatch;
      const formState = formByKey.get(matchedKey);
      if (!formState) return fullMatch;
      const result = `<li${prefix}${formState.checked}${middle}${text}${suffix}`;
      return result.replace(
        /<input type="checkbox"(?:\s+checked="checked")?>/,
        formState.checked
          ? '<input type="checkbox" checked="checked">'
          : '<input type="checkbox">'
      );
    }
  );

  const existingKeys = existingItems.map((i) => i.normalized);
  const toAppend = formItems.filter(
    (f) => !findFuzzyMatch(f.normalized, existingKeys)
  );
  if (toAppend.length === 0) return updatedExisting;

  const appendHtml = toAppend
    .map((f) => {
      const checkedAttr = f.checked ? ' checked="checked"' : "";
      return `<li data-type="taskItem" data-checked="${f.checked}"><label><input type="checkbox"${checkedAttr}><span></span></label><div><p>${f.rawText}</p></div></li>`;
    })
    .join("\n");

  return updatedExisting.replace(/<\/ul>\s*$/i, `${appendHtml}</ul>`);
}

/**
 * Convert Tiptap-flavored test scenario HTML back to markdown with checkbox
 * state preserved. Used to feed test scenarios into AI prompts without losing
 * [x]/[ ] information — `stripHtml` flattens everything to plain text and the
 * AI then regenerates all items as unchecked.
 *
 * Only supports the subset of elements we actually emit for scenarios:
 * headings (h1-h6), task list items (<li data-type="taskItem">), and plain
 * paragraphs. Everything else is dropped so the output stays concise.
 */
export function testScenariosToMarkdown(html: string): string {
  if (!html) return "";

  const parts: string[] = [];
  // Match any taskItem li regardless of attribute order; extract checked state
  // from the data-checked attribute in a separate scan so callers don't depend
  // on data-type appearing before data-checked.
  const tokenRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>|<li([^>]*data-type="taskItem"[^>]*)>([\s\S]*?)<\/li>|<p[^>]*>([\s\S]*?)<\/p>/gi;

  let match;
  while ((match = tokenRegex.exec(html)) !== null) {
    const [, hLevel, hText, liAttrs, liBody, pText] = match;
    if (hLevel) {
      const level = Math.min(parseInt(hLevel, 10), 6);
      const text = hText.replace(/<[^>]*>/g, "").trim();
      if (text) parts.push(`${"#".repeat(level)} ${text}`);
    } else if (liAttrs !== undefined) {
      const checkedMatch = liAttrs.match(/data-checked="(true|false)"/i);
      const checked = checkedMatch ? checkedMatch[1] === "true" : false;
      const inner = liBody.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const text = (inner ? inner[1] : liBody).replace(/<[^>]*>/g, "").trim();
      if (text) parts.push(`- [${checked ? "x" : " "}] ${text}`);
    } else if (pText) {
      // Skip paragraphs emitted inside taskItem <div><p>…</p></div> — those are
      // already handled by the li branch. We detect via tokenRegex ordering:
      // once this branch fires, the li regex failed, meaning this <p> is not
      // inside a task list item we've captured.
      const text = pText.replace(/<[^>]*>/g, "").trim();
      if (text && !text.includes("[ ]") && !text.includes("[x]")) {
        parts.push(text);
      }
    }
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Heading-aware append (IDE-334)
//
// Appending a chat reply used to glue it onto the end of the field, so a reply
// that opened with `## Regresyon` produced a second Regresyon section on a card
// that already had one — and pressing Append twice wrote every item twice.
// Both tokenizers below cut a document into a flat list of blocks; mergeSections
// then drops each incoming section's body into the matching existing section
// and skips blocks that are already there.
// ---------------------------------------------------------------------------

interface SectionBlock {
  /** Normalized heading text for heading blocks, null for body blocks. */
  key: string | null;
  /** Heading level 1-6, 0 for body blocks. */
  level: number;
  raw: string;
  /** Comparison text for duplicate detection; null when it can't be compared. */
  dedupe: string | null;
  /** Markdown list item — consecutive items join with a single newline. */
  list?: boolean;
}

type DedupeScope = "document" | "section";

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

// Level-agnostic on purpose: the AI writes `###` one time and `##` the next.
function normalizeHeading(text: string): string {
  return decodeEntities(text.replace(/<[^>]*>/g, ""))
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*:$/, "")
    .toLocaleLowerCase("tr");
}

function dedupeKey(text: string): string | null {
  return normalizeTaskText(decodeEntities(text.replace(/<[^>]*>/g, " "))) || null;
}

/** Index where the section opened by `blocks[headingIdx]` ends (exclusive). */
function sectionEnd(blocks: SectionBlock[], headingIdx: number): number {
  const level = blocks[headingIdx].level;
  for (let i = headingIdx + 1; i < blocks.length; i++) {
    if (blocks[i].key !== null && blocks[i].level <= level) return i;
  }
  return blocks.length;
}

function lastHeadingIndex(blocks: SectionBlock[], key?: string): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].key !== null && (key === undefined || blocks[i].key === key)) return i;
  }
  return -1;
}

function dedupeKeysIn(blocks: SectionBlock[], from: number, to: number): Set<string> {
  const keys = new Set<string>();
  for (let i = from; i < to; i++) {
    const b = blocks[i];
    if (b.key === null && b.dedupe) keys.add(b.dedupe);
  }
  return keys;
}

/**
 * Merge `incoming` blocks into `existing`:
 * - a heading that already exists (last occurrence wins) gets the incoming body
 *   appended at the end of its section — before the next heading of the same
 *   or a higher level, so nested subsections stay above it;
 * - an unknown heading nested under a matched incoming heading lands at the end
 *   of that section; any other unknown heading goes to the end of the document;
 * - body text before the first incoming heading goes to the end, as before.
 * Body blocks whose dedupe key already exists within `scope` are skipped.
 */
function mergeSections(
  existing: SectionBlock[],
  incoming: SectionBlock[],
  scope: DedupeScope
): { blocks: SectionBlock[]; added: number } {
  const result = [...existing];
  let added = 0;

  const groups: { heading: SectionBlock | null; body: SectionBlock[] }[] = [];
  for (const block of incoming) {
    if (block.key !== null) groups.push({ heading: block, body: [] });
    else if (groups.length) groups[groups.length - 1].body.push(block);
    else groups.push({ heading: null, body: [block] });
  }

  // Incoming headings already placed, mapped to their block in `result`.
  const stack: { level: number; block: SectionBlock }[] = [];

  for (const group of groups) {
    let insertAt: number;
    let scopeStart: number;
    let target: SectionBlock | null = null;

    if (!group.heading) {
      insertAt = result.length;
      scopeStart = Math.max(0, lastHeadingIndex(result));
    } else {
      while (stack.length && stack[stack.length - 1].level >= group.heading.level) stack.pop();
      const matchIdx = lastHeadingIndex(result, group.heading.key!);
      if (matchIdx >= 0) {
        target = result[matchIdx];
        insertAt = sectionEnd(result, matchIdx);
        scopeStart = matchIdx;
      } else {
        const parent = stack[stack.length - 1];
        insertAt = parent ? sectionEnd(result, result.indexOf(parent.block)) : result.length;
        scopeStart = insertAt;
      }
    }

    const seen =
      scope === "document"
        ? dedupeKeysIn(result, 0, result.length)
        : dedupeKeysIn(result, scopeStart, insertAt);
    const accepted: SectionBlock[] = [];
    for (const block of group.body) {
      if (block.dedupe && seen.has(block.dedupe)) continue;
      if (block.dedupe) seen.add(block.dedupe);
      accepted.push(block);
    }

    if (group.heading && !target) {
      // A new heading whose every item already exists elsewhere adds nothing.
      if (group.body.length && !accepted.length) continue;
      accepted.unshift(group.heading);
      target = group.heading;
    }

    if (accepted.length) {
      result.splice(insertAt, 0, ...accepted);
      added += accepted.length;
    }
    if (group.heading && target) stack.push({ level: group.heading.level, block: target });
  }

  return { blocks: result, added };
}

const MD_HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const MD_LIST_ITEM = /^(?: {0,1})(?:[-*+]|\d+[.)])\s+/;
const MD_FENCE = /^ {0,3}(```|~~~)/;
const MD_TASK_PREFIX = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/;

function tokenizeMarkdownSections(markdown: string): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let current: string[] = [];
  let currentIsList = false;

  const flush = () => {
    if (!current.length) return;
    const raw = current.join("\n");
    const text = currentIsList ? raw.replace(MD_TASK_PREFIX, "") : raw;
    blocks.push({ key: null, level: 0, raw, dedupe: dedupeKey(text), list: currentIsList });
    current = [];
    currentIsList = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = line.match(MD_FENCE);
    if (fence) {
      // A fenced block is one opaque body block; `#` lines inside aren't headings.
      flush();
      const fenceLines = [line];
      for (i++; i < lines.length; i++) {
        fenceLines.push(lines[i]);
        if (lines[i].trimStart().startsWith(fence[1])) break;
      }
      const raw = fenceLines.join("\n");
      blocks.push({ key: null, level: 0, raw, dedupe: dedupeKey(raw) });
      continue;
    }

    const heading = line.match(MD_HEADING);
    if (heading) {
      flush();
      const key = normalizeHeading(heading[2]);
      if (key) {
        blocks.push({ key, level: heading[1].length, raw: line.trim(), dedupe: null });
      }
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    if (MD_LIST_ITEM.test(line)) {
      flush();
      current = [line];
      currentIsList = true;
      continue;
    }

    current.push(line);
  }
  flush();
  return blocks;
}

function joinMarkdownBlocks(blocks: SectionBlock[]): string {
  let out = "";
  blocks.forEach((block, i) => {
    if (i > 0) {
      // A blank line between list items makes marked emit a loose list
      // (`<li><p><input…`), which the taskList conversion doesn't recognize.
      out += blocks[i - 1].list && block.list ? "\n" : "\n\n";
    }
    out += block.raw;
  });
  return out;
}

/**
 * Heading-aware append for test-scenario markdown. `existing` is the stored
 * checklist round-tripped through testScenariosToMarkdown. A checklist item is
 * skipped when the same item (after normalizeTaskText) exists anywhere in the
 * document — exact match on purpose: findFuzzyMatch is fine for carrying a
 * checked state over but would drop genuinely different scenarios here.
 */
export function mergeTestMarkdownSections(
  existing: string,
  incoming: string
): { markdown: string; added: number } {
  const incomingBlocks = tokenizeMarkdownSections(incoming);
  if (!existing.trim()) return { markdown: incoming, added: incomingBlocks.length };

  const { blocks, added } = mergeSections(tokenizeMarkdownSections(existing), incomingBlocks, "document");
  if (added === 0) return { markdown: existing, added };
  return { markdown: joinMarkdownBlocks(blocks), added };
}

const HTML_VOID_TAG = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;

/**
 * Split HTML into its top-level elements. Tiptap stores a flat list of block
 * nodes, so string-level splitting is safe. Returns null on unbalanced markup.
 */
function splitTopLevelHtml(html: string): string[] | null {
  const parts: string[] = [];
  const tagRe = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let depth = 0;
  let start = -1;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(html)) !== null) {
    if (!match[2]) continue; // comment
    if (depth === 0) {
      const text = html.slice(lastEnd, match.index).trim();
      if (text) parts.push(`<p>${text}</p>`);
      start = match.index;
    }
    const closing = match[1] === "/";
    const selfClosing = match[3] === "/" || HTML_VOID_TAG.test(match[2]);
    if (closing) depth--;
    else if (!selfClosing) depth++;
    if (depth < 0) return null;
    if (depth === 0) {
      parts.push(html.slice(start, tagRe.lastIndex));
      lastEnd = tagRe.lastIndex;
    }
  }
  if (depth !== 0) return null;
  const tail = html.slice(lastEnd).trim();
  if (tail) parts.push(`<p>${tail}</p>`);
  return parts;
}

function tokenizeHtmlSections(html: string): SectionBlock[] | null {
  const parts = splitTopLevelHtml(html);
  if (!parts) return null;
  return parts.map((raw) => {
    const heading = raw.match(/^<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>$/i);
    if (heading) {
      const key = normalizeHeading(heading[2]);
      if (key) return { key, level: parseInt(heading[1], 10), raw, dedupe: null };
    }
    return { key: null, level: 0, raw, dedupe: dedupeKey(raw) };
  });
}

/**
 * Heading-aware append for the rich-text fields (Detail, Solution, Opinion).
 * A top-level block (paragraph, list, …) whose text already exists in the
 * section it would land in is skipped. Falls back to plain concatenation when
 * either side can't be split cleanly.
 */
export function mergeHtmlSections(
  existing: string,
  incoming: string
): { html: string; added: number } {
  const incomingBlocks = tokenizeHtmlSections(incoming);
  if (!existing.trim()) return { html: incoming, added: incomingBlocks?.length ?? 1 };

  const existingBlocks = tokenizeHtmlSections(existing);
  if (!existingBlocks || !incomingBlocks) {
    return { html: `${existing}\n${incoming}`, added: 1 };
  }

  const { blocks, added } = mergeSections(existingBlocks, incomingBlocks, "section");
  if (added === 0) return { html: existing, added };
  return { html: blocks.map((b) => b.raw).join("\n"), added };
}

/**
 * Check if content is already HTML (starts with < tag)
 */
export function isHtml(content: string): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  return trimmed.startsWith("<") && trimmed.includes(">");
}

/**
 * Convert markdown to HTML only if not already HTML
 * This prevents double-conversion
 */
export function ensureHtml(content: string): string {
  if (!content || content.trim() === "") {
    return "";
  }
  if (isHtml(content)) {
    return content;
  }
  return markdownToTiptapHtml(content);
}

/**
 * Test scenarios are especially sensitive because a temporary fallback to
 * plain checkbox HTML or plain <ul>/<li> would make checkbox-preservation
 * logic blind. Always normalize incoming HTML to TipTap's taskList schema.
 */
export function ensureTestScenariosHtml(content: string): string {
  if (!content || content.trim() === "") {
    return "";
  }

  if (!isHtml(content)) {
    return normalizeTestsHtml(markdownToTiptapHtml(content));
  }

  return normalizeTestsHtml(convertCheckboxListHtmlToTaskList(content));
}
