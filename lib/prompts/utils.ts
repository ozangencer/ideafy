/** Strip HTML tags from a string. */
export function stripHtml(html: string): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Convert marked checkbox output to TipTap TaskList format.
 * marked outputs: `<li><input disabled="" type="checkbox"> text</li>`
 * TipTap expects: `<ul data-type="taskList"><li data-type="taskItem" data-checked="false">text</li></ul>`
 */
export function convertToTipTapTaskList(html: string): string {
  // Handle checked items first so the unchecked pattern doesn't eat them.
  let result = html
    .replace(/<li><input[^>]*checked[^>]*>\s*/gi, '<li data-type="taskItem" data-checked="true">')
    .replace(/<li><input[^>]*type="checkbox"[^>]*>\s*/gi, '<li data-type="taskItem" data-checked="false">');

  result = result.replace(/<ul>(\s*<li data-type="taskItem")/g, '<ul data-type="taskList">$1');

  return result;
}

/** Escape shell arguments for safe command execution. */
export function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
