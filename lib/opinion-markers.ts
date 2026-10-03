// Reads the markers an AI Opinion carries — today only the verdict.
//
// Every path that writes an opinion (Evaluate, Apply from chat, the MCP
// save_opinion tool) reads the verdict through this file, so a "Maybe" means
// the same thing wherever it was written. The word decides, never the score:
// a Maybe stays a Maybe at 8/10.
//
// Import-free on purpose: the MCP bundle pulls it in through lib/card-ops.

export type VerdictWord = "strong_yes" | "yes" | "maybe" | "no" | "strong_no";
export type AiVerdictValue = "positive" | "negative" | "maybe";

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
  /(?<!\p{L})(strong\s+yes|güçlü\s+evet|strong\s+no|güçlü\s+hayır|maybe|belki|yes|evet|no|hayır)(?!\p{L})/iu;

// Turkish opinions sometimes title the section "Özet Kararı".
const HEADING = /^#{1,6}\s*(?:summary\s+verdict|özet\s+kararı)(?!\p{L})(.*)$/imu;
const NEXT_HEADING = /^#{1,6}\s/m;

/** Saved opinions are TipTap HTML; turn them back into markdown-ish lines. */
function normalize(input: string): string {
  if (!/<[a-z][^>]*>/i.test(input)) return input;
  return input
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

/**
 * The first verdict word in the Summary Verdict section — its heading line
 * ("## Summary Verdict (Yes)") and body up to the next heading. Null when the
 * section is missing or names no verdict; the rest of the text is never read.
 */
export function parseVerdictWord(markdownOrHtml: string): VerdictWord | null {
  const text = normalize(markdownOrHtml);
  const heading = HEADING.exec(text);
  if (!heading) return null;
  const after = text.slice(heading.index + heading[0].length);
  const next = NEXT_HEADING.exec(after);
  const section = `${heading[1]}\n${next ? after.slice(0, next.index) : after}`;
  const match = WORD.exec(section);
  if (!match) return null;
  return WORD_ALIASES[match[1].toLocaleLowerCase("tr").replace(/\s+/g, " ")] ?? null;
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
