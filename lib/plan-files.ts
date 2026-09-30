// What a written plan says it will touch, and whether two such lists share a
// file. list_open_work (mcp-server/card-search.ts) reads it to flag open cards
// that collide; the run queue reads it to warn when a card lined up behind
// another edits the same files.
//
// ZERO imports: scripts/sync-mcp-shared.mjs copies this file verbatim into
// mcp-server/, which cannot reach lib/.

// Pasted screenshots are stored inline as base64; a three-letter term would
// match inside them at random, so they go before anything else.
const BASE64_IMG = /<img[^>]*src=["']data:[^"']*["'][^>]*>/gi;

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m);
}

// Tiptap HTML → plain text. Block boundaries become newlines so a caller that
// cares about lines (the plan's Files: line) still has them.
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return decodeEntities(
    html
      .replace(BASE64_IMG, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|h[1-6]|div|tr|pre|blockquote)>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .trim();
}

// A token counts as a path when it ends in an extension or a glob. Prose like
// "and/or" has a slash but neither.
const PATH_TOKEN = /^[\w@.\-[\]/*]+$/;
const PATH_TAIL = /(\.[a-z0-9]{1,6}|\/\*+)$/i;

function pathTokens(text: string): string[] {
  const found: string[] = [];
  for (const raw of text.replace(/\([^)]*\)/g, " ").split(/[\s,;|]+/)) {
    const token = raw.replace(/^[`'"“”:.]+|[`'"“”:.]+$/g, "");
    if (token && PATH_TOKEN.test(token) && PATH_TAIL.test(token)) found.push(token);
  }
  return Array.from(new Set(found));
}

// The files a written plan says it will change. Every voice ends the plan on
// a `Files:` line or a "Files to Modify" section; the line wins because it is
// the complete list. A plan that names its files in prose only ("the search
// component") matches nothing — an accepted false negative.
export function extractPlanFiles(solutionHtml: string | null | undefined): string[] {
  const text = htmlToText(solutionHtml);
  if (!text) return [];

  const filesLines = text.match(/^\s*(?:Files|Dosyalar)\s*:(.*)$/gim);
  if (filesLines?.length) {
    const last = filesLines[filesLines.length - 1];
    return pathTokens(last.slice(last.indexOf(":") + 1));
  }

  const section = text.match(/Files to Modify\s*\n([\s\S]*?)(?:\n(?:Implementation Steps|Edge Cases|Dependencies)\b|$)/i);
  return section ? pathTokens(section[1]) : [];
}

export function normalizePath(path: string): string {
  return path.trim().replace(/^\.\//, "").replace(/\/+$/, "");
}

// `dir/*` or `dir/**` covers everything under dir; anything else is exact.
export function pathsOverlap(a: string, b: string): boolean {
  const globRoot = (p: string) => (/\/\*+$/.test(p) ? p.replace(/\/\*+$/, "/") : null);
  const ga = globRoot(a);
  const gb = globRoot(b);
  if (ga && gb) return ga.startsWith(gb) || gb.startsWith(ga);
  if (ga) return b.startsWith(ga);
  if (gb) return a.startsWith(gb);
  return a === b;
}

/** The files in `a` that `b` also touches, in `a`'s order, deduped. */
export function sharedPlanFiles(a: string[], b: string[]): string[] {
  const other = b.map(normalizePath);
  const shared = a.map(normalizePath).filter((file) => other.some((o) => pathsOverlap(file, o)));
  return Array.from(new Set(shared));
}
