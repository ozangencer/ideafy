import { AutocompleteKind } from "./types";

// Remove trigger text and ensure trailing space for cursor breathing room.
export const stripTrigger = (text: string, pattern: RegExp, replacement = ""): string => {
  const result = text.replace(pattern, replacement).trimStart();
  return result ? result.trimEnd() + " " : "";
};

interface TriggerSpec {
  kind: AutocompleteKind;
  /** Regex matched against the current input value (anchored at end). */
  detect: RegExp;
  /** Regex used to strip the trigger from a title-style input after selection. */
  strip: RegExp;
  /** Computes how many chars make up the trigger (used to delete it from the Tiptap editor). */
  triggerLength: (match: RegExpMatchArray, query: string) => number;
  /** Captured group index for the query portion. */
  queryGroup: number;
}

// Order matters: first match wins, matching the precedence of the original
// sequential if/else chain (project → status → complexity → platform).
const TRIGGERS: TriggerSpec[] = [
  {
    kind: "project",
    detect: /@([\w\-.]*)$/,
    strip: /@[\w\-.]*$/,
    triggerLength: (m) => m[0].length,
    queryGroup: 1,
  },
  {
    kind: "status",
    // Slash must be at start or after whitespace, followed by word chars (or bare `/ `).
    detect: /(?:^|(?<=\s))\/([\w]+)$|(?:^|\s)\/$/,
    strip: /(?:^|\s)\/[\w]*$/,
    triggerLength: (_m, query) => 1 + query.length,
    queryGroup: 1,
  },
  {
    kind: "complexity",
    detect: /(?:^|\s)c:([\w]*)$/,
    strip: /(?:^|\s)c:[\w]*$/,
    triggerLength: (_m, query) => 2 + query.length,
    queryGroup: 1,
  },
  {
    kind: "platform",
    detect: /\[([\w]*)$/,
    strip: /\[[\w]*$/,
    triggerLength: (m) => m[0].length,
    queryGroup: 1,
  },
];

export interface DetectedTrigger {
  kind: AutocompleteKind;
  query: string;
  /** Visible length of the trigger in the source text; used for Tiptap deleteBackwards. */
  triggerLength: number;
  /** Pattern for removing the trigger from title input after selection. */
  stripPattern: RegExp;
}

export function detectTrigger(value: string): DetectedTrigger | null {
  for (const spec of TRIGGERS) {
    const match = value.match(spec.detect);
    if (!match) continue;
    const query = match[spec.queryGroup] ?? "";
    return {
      kind: spec.kind,
      query,
      triggerLength: spec.triggerLength(match, query),
      stripPattern: spec.strip,
    };
  }
  return null;
}

// Strip pattern lookup for programmatic dismissal (e.g. Escape).
export const STRIP_PATTERNS: Record<AutocompleteKind, RegExp> = {
  project: TRIGGERS[0].strip,
  status: TRIGGERS[1].strip,
  complexity: TRIGGERS[2].strip,
  platform: TRIGGERS[3].strip,
};
