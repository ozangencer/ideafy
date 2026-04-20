// Normalize SQLite INTEGER boolean columns (stored as 0/1 or NULL) to JS
// values. Null/undefined stays null so callers can distinguish "no override"
// from "explicit false".
export function normalizeUseWorktree(
  value: number | boolean | null | undefined
): boolean | null {
  if (value === null || value === undefined) return null;
  return Boolean(value);
}

// Reverse direction: JS boolean|null → SQLite INTEGER|NULL. null stays null
// (clears the override); true → 1; false → 0.
export function serializeUseWorktreeForDb(
  value: boolean | null
): 0 | 1 | null {
  if (value === null) return null;
  return value ? 1 : 0;
}
