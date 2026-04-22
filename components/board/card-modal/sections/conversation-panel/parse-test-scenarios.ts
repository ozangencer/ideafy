export interface TestScenarioItem {
  text: string;
  group: string;
  checked: boolean;
}

/**
 * Parse a TipTap taskList HTML string into individual scenario items.
 * Only `taskItem` list items are returned (not plain headings); the most
 * recent heading preceding each item becomes the `group` label so the UI
 * can render grouped scenario lists.
 */
export function parseTestScenarios(html: string): TestScenarioItem[] {
  const items: TestScenarioItem[] = [];
  let currentGroup = "";

  // Collect heading positions so each taskItem can be labelled with the most
  // recent heading that precedes it.
  const headingRegex = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g;
  const headings = new Map<number, string>();
  let hMatch;
  while ((hMatch = headingRegex.exec(html)) !== null) {
    headings.set(hMatch.index, hMatch[1].replace(/<[^>]*>/g, "").trim());
  }

  const liRegex = /<li([^>]*)data-type="taskItem"([^>]*)>([\s\S]*?)<\/li>/g;
  let match;
  while ((match = liRegex.exec(html)) !== null) {
    for (const [pos, title] of Array.from(headings)) {
      if (pos < match.index) currentGroup = title;
    }
    // `data-checked` can land in either attribute group depending on render order.
    const attrs = match[1] + match[2];
    const checked = attrs.includes('data-checked="true"');
    const text = match[3].replace(/<[^>]*>/g, "").trim();
    if (text) {
      items.push({ text, group: currentGroup, checked });
    }
  }
  return items;
}
