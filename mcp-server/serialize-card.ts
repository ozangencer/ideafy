// Normalize SQLite INTEGER boolean columns (stored as 0/1 or NULL) to JS
// values. Null/undefined stays null so callers can distinguish "no override"
// from "explicit false".
export function normalizeUseWorktree(
  value: number | boolean | null | undefined
): boolean | null {
  if (value === null || value === undefined) return null;
  return Boolean(value);
}
