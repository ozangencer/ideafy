// file:// ↔ absolute path helpers for artifact chips. Pure string code: the
// editor (client), the apply route and the prompt builder all share it.

export type ArtifactKind = "html" | "image" | "doc" | "file";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "heic", "bmp"]);
const DOC_EXT = new Set(["md", "markdown", "pdf", "txt", "doc", "docx", "pptx", "xlsx", "csv", "rtf", "key", "pages", "numbers"]);
const HTML_EXT = new Set(["html", "htm"]);

/**
 * `file:///Users/a/b%20c.html` → `/Users/a/b c.html`. Returns null for anything
 * that is not an absolute local file URL (remote hosts, relative paths, `~`).
 */
export function fileUrlToPath(href: string | null | undefined): string | null {
  if (!href) return null;
  const match = href.trim().match(/^file:\/\/(localhost)?(\/[^?#]*)/i);
  if (!match) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[2]);
  } catch {
    decoded = match[2];
  }
  if (!decoded.startsWith("/") || decoded.includes("\0")) return null;
  return decoded;
}

/** `/Users/a/b c.html` → `file:///Users/a/b%20c.html`, one segment at a time so `#` and `?` survive. */
export function pathToFileUrl(absolutePath: string): string {
  return `file://${absolutePath.split("/").map(encodeURIComponent).join("/")}`;
}

// Text that names a local file: an absolute path under a home, temp or volume
// folder, or `~/…`. Route-like strings such as `/api/open-file` do not match.
const LOCAL_PATH_RE = /^(~\/|\/(Users|home|tmp|private|var\/folders|Volumes)\/)\S/;

/** The path, trimmed, when `text` is a single-line local file path; otherwise null. */
export function localPathFromText(text: string | null | undefined): string | null {
  if (!text || text.includes("\n")) return null;
  const trimmed = text.trim();
  return LOCAL_PATH_RE.test(trimmed) ? trimmed : null;
}

export function artifactBasename(absolutePath: string): string {
  const parts = absolutePath.split("/").filter(Boolean);
  return parts[parts.length - 1] || absolutePath;
}

export function artifactKind(absolutePath: string): ArtifactKind {
  const ext = artifactBasename(absolutePath).split(".").pop()?.toLowerCase() || "";
  if (HTML_EXT.has(ext)) return "html";
  if (IMAGE_EXT.has(ext)) return "image";
  if (DOC_EXT.has(ext)) return "doc";
  return "file";
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Rewrite artifact chips and `file://` anchors in stored HTML as markdown links
 * so plain-text consumers (prompt context, card export) keep the file's
 * location instead of just its name. Runs before tag stripping.
 */
export function artifactHtmlToMarkdownLinks(html: string): string {
  if (!html || (!html.includes("artifactMention") && !html.includes("file://"))) return html;
  return html
    .replace(
      /<span\b[^>]*data-type="artifactMention"[^>]*>[\s\S]*?<\/span>/gi,
      (tag) => {
        const path = tag.match(/data-path="([^"]*)"/i)?.[1];
        if (!path) return tag;
        const absolute = decodeEntities(path);
        const name = decodeEntities(tag.match(/data-name="([^"]*)"/i)?.[1] || artifactBasename(absolute));
        return `[${name}](${pathToFileUrl(absolute)})`;
      },
    )
    .replace(
      /<a\b[^>]*href="(file:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (tag, href: string, inner: string) => {
        const absolute = fileUrlToPath(decodeEntities(href));
        if (!absolute) return tag;
        const text = decodeEntities(inner.replace(/<[^>]*>/g, "").trim()) || artifactBasename(absolute);
        return `[${text}](${pathToFileUrl(absolute)})`;
      },
    );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** The stored form of an artifact chip — the same markup the editor writes. */
export function artifactChipHtml(absolutePath: string, name?: string): string {
  const label = name?.trim() || artifactBasename(absolutePath);
  const pathAttr = escapeHtml(absolutePath);
  return (
    `<span data-type="artifactMention" data-path="${pathAttr}" data-name="${escapeHtml(label)}"` +
    ` data-kind="${artifactKind(absolutePath)}" title="${pathAttr}" class="mention artifact-mention">` +
    `${escapeHtml(label)}</span>`
  );
}

/**
 * Turn `<a href="file://…">text</a>` into artifact chips. The editor does the
 * same on load, but the read-only view renders stored HTML through DOMPurify,
 * which drops file: hrefs — so Apply stores chips directly.
 */
export function fileLinksToArtifactChips(html: string): string {
  if (!html || !html.includes("file://")) return html;
  return html.replace(
    /<a\b[^>]*href="(file:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (tag, href: string, inner: string) => {
      const absolute = fileUrlToPath(decodeEntities(href));
      if (!absolute) return tag;
      const text = decodeEntities(inner.replace(/<[^>]*>/g, "").trim());
      const name = !text || text.startsWith("/") || text.startsWith("file://") ? undefined : text;
      return artifactChipHtml(absolute, name);
    },
  );
}

// Inline `<code>` only — a `<code>` right after `<pre …>` is a code block.
const INLINE_CODE_RE = /(?<!<pre\b[^>]*>)<code\b[^>]*>([^<]*)<\/code>/gi;

function replaceCodePaths(html: string, render: (path: string) => string | null): string {
  if (!html || !html.includes("<code")) return html;
  return html.replace(INLINE_CODE_RE, (tag, inner: string) => {
    const path = localPathFromText(decodeEntities(inner));
    return (path && render(path)) || tag;
  });
}

/**
 * Turn backticked file paths (`<code>/Users/…/mockup.html</code>`) into
 * artifact chips. Claude often names the file that way instead of writing a
 * `file://` link; the chip opens it on click. `~/…` stays as written — the
 * open route expands it.
 */
export function codePathsToArtifactChips(html: string): string {
  return replaceCodePaths(html, (path) => artifactChipHtml(path));
}

/**
 * Apply-time variant: rewrite backticked file paths as `file://` links so the
 * persist pass can copy them into the card folder like any other artifact.
 */
export function codePathsToFileLinks(html: string, homeDir: string): string {
  return replaceCodePaths(html, (path) => {
    const absolute = path.startsWith("~/") ? `${homeDir}/${path.slice(2)}` : path;
    return `<a href="${escapeHtml(pathToFileUrl(absolute))}">${escapeHtml(artifactBasename(absolute))}</a>`;
  });
}
