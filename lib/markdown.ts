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
 * Promote plain `<ul><li>…</li></ul>` content to Tiptap taskList (all items
 * unchecked). Apply before reading/merging test-scenario HTML so callers that
 * only know the taskItem schema (extractTaskItems, mergeTestCheckState) can
 * still see items produced by markdown without `- [ ]` prefixes or by older
 * writes that stored plain lists. Idempotent: lists already tagged
 * `data-type="taskList"` (or containing any taskItem child) are left alone.
 */
export function normalizeTestsHtml(html: string): string {
  if (!html) return html;
  return convertCheckboxListHtmlToTaskList(html).replace(
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
  const regex = /<li[^>]*data-type="taskItem"[^>]*data-checked="(true|false)"[^>]*>.*?<p>(.*?)<\/p>/gi;
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
    /<li([^>]*data-type="taskItem"[^>]*data-checked=")(?:true|false)("[^>]*>.*?<p>)(.*?)(<\/p>)/gi,
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
    /<li([^>]*data-type="taskItem"[^>]*data-checked=")(?:true|false)("[^>]*>.*?<p>)(.*?)(<\/p>)/gi,
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
