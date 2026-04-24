import { marked } from "marked";

// Configure marked for Tiptap-compatible HTML
marked.setOptions({
  gfm: true,
  breaks: true,
});

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

  // Convert standard checkbox lists to Tiptap TaskList format
  // Match: <ul> containing <li><input ...checkbox...> items
  html = html.replace(
    /<ul>\s*((?:<li><input[^>]*type="checkbox"[^>]*>\s*[^<]*<\/li>\s*)+)<\/ul>/gi,
    (match, items) => {
      const taskItems = items.replace(
        /<li><input([^>]*)type="checkbox"([^>]*)>\s*([^<]*)<\/li>/gi,
        (
          _itemMatch: string,
          before: string,
          after: string,
          text: string
        ) => {
          const isChecked =
            before.includes("checked") || after.includes("checked");
          return `<li data-type="taskItem" data-checked="${isChecked}"><label><input type="checkbox"${isChecked ? ' checked="checked"' : ""}><span></span></label><div><p>${text.trim()}</p></div></li>`;
        }
      );
      return `<ul data-type="taskList">${taskItems}</ul>`;
    }
  );

  return html;
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
  return html.replace(
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
  const tokenRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>|<li[^>]*data-type="taskItem"[^>]*data-checked="(true|false)"[^>]*>([\s\S]*?)<\/li>|<p[^>]*>([\s\S]*?)<\/p>/gi;

  let match;
  while ((match = tokenRegex.exec(html)) !== null) {
    const [, hLevel, hText, checked, liBody, pText] = match;
    if (hLevel) {
      const level = Math.min(parseInt(hLevel, 10), 6);
      const text = hText.replace(/<[^>]*>/g, "").trim();
      if (text) parts.push(`${"#".repeat(level)} ${text}`);
    } else if (checked !== undefined) {
      const inner = liBody.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const text = (inner ? inner[1] : liBody).replace(/<[^>]*>/g, "").trim();
      if (text) parts.push(`- [${checked === "true" ? "x" : " "}] ${text}`);
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
