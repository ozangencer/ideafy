// `[COMPLEXITY: …]` / `[PRIORITY: …]` markers the model writes at the end of a
// plan or opinion. Kept free of TipTap imports so node tests can load it.

export type EstimateMarkerKind = "complexity" | "priority";

export interface EstimateMarkerMatch {
  /** Offsets of the whole `[KEY: value]` marker within the input text. */
  from: number;
  to: number;
  /** Offsets of the value alone, e.g. `medium`. */
  valueFrom: number;
  valueTo: number;
  kind: EstimateMarkerKind;
  value: string;
}

// Same value sets the start/evaluate routes accept, so the prompt template's
// literal `[COMPLEXITY: trivial/low/medium/high/very_high]` never matches.
const MARKER_RE = /\[(COMPLEXITY|PRIORITY):\s*(trivial|low|medium|high|very_high)\]/gi;

const VALID_VALUES: Record<EstimateMarkerKind, readonly string[]> = {
  complexity: ["trivial", "low", "medium", "high", "very_high"],
  priority: ["low", "medium", "high"],
};

export function findEstimateMarkers(text: string): EstimateMarkerMatch[] {
  if (!text.includes("[")) return [];
  const matches: EstimateMarkerMatch[] = [];
  for (const m of text.matchAll(MARKER_RE)) {
    const kind = m[1].toLowerCase() as EstimateMarkerKind;
    const value = m[2].toLowerCase();
    if (!VALID_VALUES[kind].includes(value)) continue;
    const from = m.index ?? 0;
    const to = from + m[0].length;
    const valueTo = to - 1;
    matches.push({ from, to, valueFrom: valueTo - m[2].length, valueTo, kind, value });
  }
  return matches;
}
