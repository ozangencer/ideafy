/**
 * `cards.output_paths` is a JSON text column holding the files a card's work
 * produced, relative to the project folder. The MCP save_output tool writes
 * it; the app only reads it back. One parser so every Card constructor
 * tolerates the same things: null, an empty string, and a value that is not
 * a JSON array of strings (a hand-edited row, a backup from a stranger).
 */
export function parseOutputPaths(value: string | null | undefined): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const paths = parsed.filter((entry): entry is string => typeof entry === "string");
    return paths.length ? paths : null;
  } catch {
    return null;
  }
}
