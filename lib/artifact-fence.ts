// Mockups arrive as a fenced block in the chat reply, not as a file the model
// writes: ```html artifact="name.html" … ```. Chat-stream saves each closed
// block into the card's scratch/ folder and swaps it for a link (IDE-397), so
// every provider gets mockups without a write permission. Pure string code —
// the chat renderer (client) collapses the same blocks while they stream.

// Insurance against runaway output, not a budget: the prompt asks for ~30 KB.
export const ARTIFACT_FENCE_MAX_BYTES = 512 * 1024;

const ALLOWED_EXT = new Set(["html", "htm", "svg"]);
const MAX_NAME_LENGTH = 80;

export interface ArtifactFence {
  /** Offset of the opening fence line. */
  start: number;
  /** Offset just past the closing fence line, or the text's end while open. */
  end: number;
  /** Sanitised basename, or null when the requested name cannot be used. */
  filename: string | null;
  body: string;
  closed: boolean;
}

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ARTIFACT_ATTR_RE = /\bartifact\s*=\s*(?:"([^"]*)"|'([^']*)')/;

/**
 * `../../etc/My Mockup.HTML` → `my-mockup.html`. A missing extension is taken
 * from the fence language; anything other than html/svg is refused.
 */
export function sanitizeArtifactFilename(raw: string, lang = ""): string | null {
  const base = raw.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const name = base
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[.-]+/, "");
  const dot = name.lastIndexOf(".");
  let stem = dot > 0 ? name.slice(0, dot) : name;
  let ext = dot > 0 ? name.slice(dot + 1) : "";
  if (!ext) ext = lang.toLowerCase() === "svg" ? "svg" : "html";
  if (!ALLOWED_EXT.has(ext)) return null;
  stem = stem.replace(/\.+$/, "").slice(0, MAX_NAME_LENGTH - ext.length - 1) || "mockup";
  return `${stem}.${ext}`;
}

/**
 * Every ```lang artifact="…" block in `text`, in order. Ordinary code fences —
 * and anything quoted inside them — are skipped, so an HTML example in a reply
 * never turns into a file. A block still streaming is returned with
 * `closed: false` and runs to the end of the text.
 */
export function extractArtifactFences(text: string): ArtifactFence[] {
  const fences: ArtifactFence[] = [];
  if (!text || !text.includes("artifact")) return fences;

  let open: { marker: string; start: number; bodyStart: number; filename: string | null; artifact: boolean } | null = null;
  let offset = 0;

  while (offset <= text.length) {
    const newline = text.indexOf("\n", offset);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(offset, lineEnd);

    if (!open) {
      const match = line.match(FENCE_OPEN_RE);
      if (match && !(match[1][0] === "`" && match[2].includes("`"))) {
        const info = match[2].trim();
        const attr = info.match(ARTIFACT_ATTR_RE);
        const lang = info.split(/\s+/)[0] ?? "";
        open = {
          marker: match[1],
          start: offset,
          bodyStart: newline === -1 ? text.length : newline + 1,
          filename: attr ? sanitizeArtifactFilename(attr[1] ?? attr[2] ?? "", lang) : null,
          artifact: !!attr,
        };
      }
    } else {
      const trimmed = line.trim();
      if (
        trimmed.length >= open.marker.length &&
        trimmed[0] === open.marker[0] &&
        /^(`+|~+)$/.test(trimmed)
      ) {
        if (open.artifact) {
          fences.push({
            start: open.start,
            end: lineEnd,
            filename: open.filename,
            body: text.slice(open.bodyStart, Math.max(open.bodyStart, offset - 1)),
            closed: true,
          });
        }
        open = null;
      }
    }

    if (newline === -1) break;
    offset = newline + 1;
  }

  if (open?.artifact) {
    fences.push({
      start: open.start,
      end: text.length,
      filename: open.filename,
      body: text.slice(open.bodyStart),
      closed: false,
    });
  }
  return fences;
}

function formatSize(body: string): string {
  const bytes = new TextEncoder().encode(body).length;
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * Replace each artifact block with a one-line note for display while the
 * reply streams: an open block is still being written, a closed one waits for
 * chat-stream to save it and send the link.
 */
export function collapseArtifactFences(text: string): string {
  const fences = extractArtifactFences(text);
  if (fences.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const fence of fences) {
    const name = fence.filename ?? "mockup";
    const state = fence.closed ? "Saving mockup" : "Writing mockup";
    out += `${text.slice(cursor, fence.start)}*${state} · ${name} · ${formatSize(fence.body)}*`;
    cursor = fence.end;
  }
  return out + text.slice(cursor);
}
