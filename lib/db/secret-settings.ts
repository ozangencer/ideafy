/**
 * Settings rows that hold live credentials and must never leave the local DB.
 *
 * The `settings` table is a generic key/value store, and the backup export
 * serializes it wholesale. Without an explicit exclusion the Supabase access
 * token (a bearer JWT that impersonates the user for ~1h) ends up in cleartext
 * inside a JSON file that users treat as shareable — attach it to a support
 * ticket or drop it in a shared folder and anyone who reads it can call
 * Supabase as that user.
 *
 * The same list is applied on import, in both directions:
 *   - existing secret rows are preserved rather than wiped by the restore, and
 *   - secret keys carried by an untrusted backup file are dropped, so a
 *     crafted backup cannot plant somebody else's session token locally.
 *
 * Keys are the DB-level names (see the keyMap in app/api/settings/route.ts).
 */
export const SECRET_SETTING_KEYS = new Set<string>([
  "supabase_auth_token",
]);

export function isSecretSettingKey(key: string): boolean {
  return SECRET_SETTING_KEYS.has(key);
}

// Note: import filters on this denylist rather than an allow-list of known
// keys. An allow-list was tried and reverted — real databases carry rows the
// current keyMap can no longer write (e.g. the legacy camelCase
// `supabaseUserId`, which cloud code still reads in several places), so an
// allow-list would silently drop them on every restore. The keys a crafted
// backup could meaningfully abuse (`ai_platform`, `mcp_config_path`,
// `skills_path`) are ones the app legitimately defines, so they would have to
// be on the allow-list anyway — it would buy no protection for that risk.
