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
 * Extract task item texts and their checked states from Tiptap TaskList HTML
 */
function extractCheckStates(html: string): Map<string, boolean> {
  const map = new Map<string, boolean>();
  const regex = /<li[^>]*data-type="taskItem"[^>]*data-checked="(true|false)"[^>]*>.*?<p>(.*?)<\/p>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const checked = match[1] === "true";
    const text = match[2].trim();
    if (text) {
      map.set(text, checked);
    }
  }
  return map;
}

/**
 * Merge checked states from existing HTML into new HTML.
 * Matching is by task item text. New items stay unchecked, removed items are dropped.
 */
export function mergeTestCheckState(existingHtml: string, newHtml: string): string {
  if (!existingHtml || !newHtml) return newHtml;

  const checkedMap = extractCheckStates(existingHtml);
  if (checkedMap.size === 0) return newHtml;

  return newHtml.replace(
    /<li([^>]*data-type="taskItem"[^>]*data-checked=")(?:true|false)("[^>]*>.*?<p>)(.*?)(<\/p>)/gi,
    (fullMatch, prefix, middle, text, suffix) => {
      const trimmed = text.trim();
      const wasChecked = checkedMap.get(trimmed);
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
