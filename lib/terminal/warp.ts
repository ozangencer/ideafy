import { readFileSync } from "fs";

/**
 * Warp runs a command on open through two file-backed URI schemes:
 *
 * - `warp://launch/<name>` loads a YAML launch configuration. Its schema only
 *   knows `windows:`, so every open creates a new window. Warp now labels it
 *   "Legacy".
 * - `warp://tab_config/<name>` loads a TOML tab config and opens it as a new
 *   tab in the focused window (or a new window when none is open). This is the
 *   one we want, but it only exists from v0.2026.05.18 on — an older Warp
 *   swallows the URI silently and the user sees nothing open at all.
 *
 * So launches go through tab configs when the installed Warp is new enough and
 * fall back to launch configurations otherwise.
 * See: https://docs.warp.dev/terminal/windows/tab-configs
 */

/** First release with the `warp://tab_config/<name>` deeplink (#9379). */
export const WARP_TAB_CONFIG_MIN_VERSION = "0.2026.05.18";

const WARP_INFO_PLIST = "/Applications/Warp.app/Contents/Info.plist";

/**
 * Compare dotted numeric versions segment by segment; missing segments count
 * as 0, so "0.2026.05.18" equals "0.2026.05.18.00.00". Warp's build versions
 * are date-shaped ("0.2026.09.16.08.27.02"), which this orders correctly.
 */
export function compareVersion(a: string, b: string): number {
  const pa = a.split(".").map((s) => parseInt(s, 10) || 0);
  const pb = b.split(".").map((s) => parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** Pull CFBundleShortVersionString out of an XML Info.plist. */
export function parseBundleVersion(plist: string): string | null {
  const match = plist.match(
    /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/,
  );
  return match ? match[1].trim() : null;
}

let cachedSupport: boolean | null = null;

/**
 * Whether the installed Warp understands `warp://tab_config`. An unreadable
 * version counts as "no": the launch-config path always opens something,
 * while a tab-config URI on an old Warp opens nothing.
 */
export function warpSupportsTabConfigs(): boolean {
  if (cachedSupport !== null) return cachedSupport;
  let version: string | null = null;
  try {
    version = parseBundleVersion(readFileSync(WARP_INFO_PLIST, "utf8"));
  } catch {}
  cachedSupport =
    version !== null &&
    compareVersion(version, WARP_TAB_CONFIG_MIN_VERSION) >= 0;
  return cachedSupport;
}

// A JSON string literal is a valid TOML basic string, except that TOML also
// requires DEL (U+007F) to be escaped, which JSON leaves raw.
function tomlString(s: string): string {
  return JSON.stringify(s).replace(/\u007f/g, "\\u007F");
}

/**
 * A single-pane tab config that runs `command` on open. The pane stays a
 * `terminal`: `agent` would open Warp's own Agent Mode instead of our CLI.
 *
 * `directory` is only a fallback — the wrapper script cds itself — and Warp
 * treats it as a template, so a path containing `{{` is left out rather than
 * risk the params modal. No `[params.*]` and no `title` either: the first
 * would prompt the user, the second gets overwritten by the agent CLI anyway.
 */
export function buildWarpTabConfig(opts: {
  name: string;
  cwd: string;
  command: string;
}): string {
  const lines = [
    `name = ${tomlString(opts.name)}`,
    "",
    "[[panes]]",
    `id = "main"`,
    `type = "terminal"`,
  ];
  if (!opts.cwd.includes("{{")) {
    lines.push(`directory = ${tomlString(opts.cwd)}`);
  }
  lines.push(`commands = [${tomlString(opts.command)}]`);
  lines.push("is_focused = true");
  return lines.join("\n") + "\n";
}
