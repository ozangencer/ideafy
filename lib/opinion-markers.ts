// Reads the markers an AI Opinion carries: verdict, score, priority and
// complexity.
//
// Every path that writes an opinion (Evaluate, Apply from chat, the MCP
// save_opinion tool) and the planning run's priority/complexity hoist read
// through this file, so the same text lands as the same card fields wherever
// it was written. The verdict word decides, never the score: a Maybe stays a
// Maybe at 8/10.
//
// Machine-readable tags come first — `[VERDICT: maybe]`, `[SCORE: 7/10]`,
// `[PRIORITY: high]`, `[COMPLEXITY: low]`. Values are English in every card
// language. An opinion written before the tags existed falls back to the
// Summary Verdict / Final Score sections, and only those sections are read.
//
// Import-free on purpose: the MCP bundle pulls it in through lib/card-ops.

export type VerdictWord = "strong_yes" | "yes" | "maybe" | "no" | "strong_no";
export type AiVerdictValue = "positive" | "negative" | "maybe";
export type MarkerLevel = "low" | "medium" | "high";

export interface OpinionMarkers {
  verdictWord: VerdictWord | null;
  verdict: AiVerdictValue | null;
  /** 0–10, whole points. */
  score: number | null;
  priority: MarkerLevel | null;
  /** Already folded onto the card's three levels (see normalizeComplexity). */
  complexity: MarkerLevel | null;
}

const WORD_ALIASES: Record<string, VerdictWord> = {
  "strong yes": "strong_yes",
  "güçlü evet": "strong_yes",
  yes: "yes",
  evet: "yes",
  maybe: "maybe",
  belki: "maybe",
  no: "no",
  hayır: "no",
  "strong no": "strong_no",
  "güçlü hayır": "strong_no",
};

// Lookarounds instead of \b: \b treats Turkish letters as word breaks, so the
// "no" in "notlarını" would match. The two-word forms come first so
// "Strong Yes" is not read as a bare "Yes".
const WORD =
  /(?<!\p{L})(strong[\s_]+yes|güçlü\s+evet|strong[\s_]+no|güçlü\s+hayır|maybe|belki|yes|evet|no|hayır)(?!\p{L})/iu;

// A tag holds exactly one value, so the prompt template's literal
// `[VERDICT: strong_yes/yes/maybe/no/strong_no]` never reads as a verdict.
const VERDICT_TAG = /\[VERDICT:\s*(strong[\s_-]?yes|yes|maybe|no|strong[\s_-]?no)\s*\]/i;
const SCORE_TAG = /\[SCORE:\s*(\d{1,2}(?:\.\d+)?)\s*(?:\/\s*10)?\s*\]/i;
const PRIORITY_TAG = /\[PRIORITY:\s*(low|medium|high)\s*\]/i;
const COMPLEXITY_TAG = /\[COMPLEXITY:\s*(trivial|simple|low|medium|high|complex|very_high)\s*\]/i;

// Turkish opinions sometimes title the sections in Turkish.
const VERDICT_HEADING = /^#{1,6}\s*(?:summary\s+verdict|özet\s+kararı)(?!\p{L})(.*)$/imu;
const SCORE_HEADING = /^#{1,6}\s*(?:final\s+score|final\s+(?:skor|puan)\p{L}*|son\s+puan\p{L}*)(?!\p{L})(.*)$/imu;
const NEXT_HEADING = /^#{1,6}\s/m;
const OUT_OF_TEN = /(?<![\d.])(\d{1,2}(?:\.\d+)?)\s*\/\s*10(?!\d)/;

/** Saved opinions are TipTap HTML; turn them back into markdown-ish lines. */
function normalize(input: string): string {
  if (!/<[a-z][^>]*>/i.test(input)) return input;
  return input
    .replace(/<pre[\s\S]*?<\/pre>/gi, "\n")
    .replace(/<code[\s\S]*?<\/code>/gi, "")
    .replace(/<h[1-6][^>]*>/gi, "\n## ")
    .replace(/<\/(h[1-6]|p|li|div)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

/** A tag quoted as code is an example (this file's own docs, a plan), not the card's value. */
function withoutCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, "\n").replace(/`[^`\n]*`/g, "");
}

function prepare(markdownOrHtml: string): string {
  return withoutCode(normalize(markdownOrHtml));
}

/** The heading line's tail and the body up to the next heading; null when absent. */
function section(text: string, heading: RegExp): string | null {
  const match = heading.exec(text);
  if (!match) return null;
  const after = text.slice(match.index + match[0].length);
  const next = NEXT_HEADING.exec(after);
  return `${match[1]}\n${next ? after.slice(0, next.index) : after}`;
}

function verdictWordIn(text: string): VerdictWord | null {
  const tag = VERDICT_TAG.exec(text);
  if (tag) return WORD_ALIASES[tag[1].toLowerCase().replace(/[\s_-]+/g, " ")] ?? null;
  const body = section(text, VERDICT_HEADING);
  if (body === null) return null;
  const match = WORD.exec(body);
  if (!match) return null;
  return WORD_ALIASES[match[1].toLocaleLowerCase("tr").replace(/[\s_]+/g, " ")] ?? null;
}

function toScore(raw: string): number | null {
  const value = Math.round(Number(raw));
  return Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;
}

function scoreIn(text: string): number | null {
  const tag = SCORE_TAG.exec(text);
  if (tag) return toScore(tag[1]);
  const body = section(text, SCORE_HEADING);
  if (body === null) return null;
  const match = OUT_OF_TEN.exec(body);
  return match ? toScore(match[1]) : null;
}

/**
 * The verdict word: the `[VERDICT: …]` tag, else the first verdict word in
 * the Summary Verdict section — its heading line ("## Summary Verdict (Yes)")
 * and body up to the next heading. Null when neither names one; the rest of
 * the text is never read.
 */
export function parseVerdictWord(markdownOrHtml: string): VerdictWord | null {
  return verdictWordIn(prepare(markdownOrHtml));
}

/** Strong Yes/Yes → positive, Maybe → maybe, No/Strong No → negative. */
export function verdictWordToAiVerdict(word: VerdictWord | null): AiVerdictValue | null {
  if (word === "strong_yes" || word === "yes") return "positive";
  if (word === "no" || word === "strong_no") return "negative";
  if (word === "maybe") return "maybe";
  return null;
}

export function parseAiVerdict(markdownOrHtml: string): AiVerdictValue | null {
  return verdictWordToAiVerdict(parseVerdictWord(markdownOrHtml));
}

/**
 * The card stores three complexity levels. Prompts still offer five
 * (trivial … very_high) and the MCP once wrote simple/complex; all of them
 * fold onto low/medium/high here. Anything else is null — never a guess.
 */
export function normalizeComplexity(value: string | null | undefined): MarkerLevel | null {
  switch ((value ?? "").trim().toLowerCase()) {
    case "trivial":
    case "simple":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "complex":
    case "very_high":
      return "high";
    default:
      return null;
  }
}

/** Every marker an opinion (or a plan) carries. A field it does not name is null. */
export function parseOpinionMarkers(markdownOrHtml: string): OpinionMarkers {
  const text = prepare(markdownOrHtml);
  const verdictWord = verdictWordIn(text);
  const priority = PRIORITY_TAG.exec(text);
  const complexity = COMPLEXITY_TAG.exec(text);
  return {
    verdictWord,
    verdict: verdictWordToAiVerdict(verdictWord),
    score: scoreIn(text),
    priority: priority ? (priority[1].toLowerCase() as MarkerLevel) : null,
    complexity: complexity ? normalizeComplexity(complexity[1]) : null,
  };
}

/** One line naming what was read, for tool results and logs: "verdict: maybe · score 6/10 · …". */
export function describeOpinionMarkers(markers: Omit<OpinionMarkers, "verdictWord">): string {
  const parts = [
    markers.verdict && `verdict: ${markers.verdict}`,
    markers.score !== null && `score ${markers.score}/10`,
    markers.priority && `priority ${markers.priority}`,
    markers.complexity && `complexity ${markers.complexity}`,
  ].filter(Boolean);
  return parts.join(" · ");
}
