/**
 * Turns whatever a failed run threw into the text the Background Processes
 * panel, the toast and the bell show. Pure and client-safe: the panel reuses
 * `firstLine` for the one-line summaries.
 */

// Stderr can run to pages; the actual cause is almost always at the end.
const MAX_ERROR_CHARS = 4096;

// CSI sequences (colours, cursor moves) and the odd OSC title sequence.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;

export function describeRunError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  let text = raw.replace(ANSI_PATTERN, "").replace(/\r\n?/g, "\n").trim();

  // "exited with code 1: " with nothing after it says nothing about why.
  text = text.replace(/(exited with code [^\s:]+):\s*$/, "$1 (no stderr output)");

  if (!text) return "The run failed without an error message.";
  if (text.length <= MAX_ERROR_CHARS) return text;

  // Keep the first line (which step failed) and the tail (why it failed).
  const head = text.split("\n", 1)[0].slice(0, 300);
  const tail = text.slice(-(MAX_ERROR_CHARS - head.length - 20));
  return `${head}\n… (truncated) …\n${tail}`;
}

/** First non-empty line, cut to `max` characters, for toasts and banners. */
export function firstLine(text: string | null | undefined, max = 160): string {
  const line = (text ?? "").split("\n").find((l) => l.trim())?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// Failures that say nothing about the card and everything about the machine:
// the next card in the run queue would die the same way within minutes.
const INFRASTRUCTURE_PATTERNS: [RegExp, string][] = [
  [/usage limit|rate.?limit|hit your limit|limit reached|quota|overloaded|\b429\b/i, "usage limit reached"],
  [/not logged in|\/login\b|log ?in again|invalid api key|authenticat|unauthori[sz]ed|\b401\b/i, "CLI is not logged in"],
  [/\bENOENT\b|command not found|not installed/i, "CLI not found"],
  [/Working directory not found/i, "project folder not found"],
  [/timed out/i, "run timed out"],
  [/Failed to create git worktree/i, "worktree could not be created"],
];

/**
 * Why a failed run points at the environment rather than the card, or null
 * when it does not. The run queue pauses on the former and moves on past the
 * latter, so a usage limit costs one card instead of every card behind it.
 * The label is short enough for a toast: "Queue paused — usage limit reached".
 */
export function infrastructureRunError(message: string | null | undefined): string | null {
  const text = message ?? "";
  for (const [pattern, label] of INFRASTRUCTURE_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

export function isInfrastructureRunError(message: string | null | undefined): boolean {
  return infrastructureRunError(message) !== null;
}
