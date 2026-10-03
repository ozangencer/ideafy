// `[COMPLEXITY: …]` / `[PRIORITY: …]` markers the model writes at the end of a
// plan or opinion, and the `[VERDICT: …]` / `[SCORE: X/10]` an opinion carries.
// Kept free of TipTap imports so node tests can load it.

export type EstimateMarkerKind = "complexity" | "priority" | "verdict" | "score";

export interface EstimateMarkerMatch {
  /** Offsets of the whole `[KEY: value]` marker within the input text. */
  from: number;
  to: number;
  /** Offsets of the value alone, e.g. `medium`. */
  valueFrom: number;
  valueTo: number;
  kind: EstimateMarkerKind;
  value: string;
  /**
   * What the chip's colour keys on (`data-level`); null for a score, which
   * stays neutral — the verdict word decides, the score only labels it.
   */
  level: string | null;
}

// Same value sets lib/opinion-markers.ts reads, so the prompt template's
// literal `[COMPLEXITY: trivial/low/medium/high/very_high]` never matches: a
// value is one word or one score, never a list.
const MARKER_RE = /\[(COMPLEXITY|PRIORITY|VERDICT|SCORE):\s*([a-z_]+|\d{1,2}(?:\s*\/\s*10)?)\]/gi;

const VALID_VALUES: Record<Exclude<EstimateMarkerKind, "score">, readonly string[]> = {
  complexity: ["trivial", "low", "medium", "high", "very_high"],
  priority: ["low", "medium", "high"],
  verdict: ["strong_yes", "yes", "maybe", "no", "strong_no"],
};

function isValid(kind: EstimateMarkerKind, value: string): boolean {
  if (kind !== "score") return VALID_VALUES[kind].includes(value);
  const points = Number(value.split("/")[0]);
  return Number.isInteger(points) && points >= 0 && points <= 10;
}

export function findEstimateMarkers(text: string): EstimateMarkerMatch[] {
  if (!text.includes("[")) return [];
  const matches: EstimateMarkerMatch[] = [];
  for (const m of text.matchAll(MARKER_RE)) {
    const kind = m[1].toLowerCase() as EstimateMarkerKind;
    const value = m[2].toLowerCase().replace(/\s+/g, "");
    if (!isValid(kind, value)) continue;
    const from = m.index ?? 0;
    const to = from + m[0].length;
    const valueTo = to - 1;
    const level = kind === "score" ? null : value;
    matches.push({ from, to, valueFrom: valueTo - m[2].length, valueTo, kind, value, level });
  }
  return matches;
}
