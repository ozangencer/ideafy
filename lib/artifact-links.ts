import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { ARTIFACT_FENCE_MAX_BYTES, extractArtifactFences } from "./artifact-fence";
import {
  artifactBasename,
  codePathsToFileLinks,
  fileLinksToArtifactChips,
  fileUrlToPath,
  pathToFileUrl,
} from "./artifact-url";

// Node built-ins and the two pure string modules above only: the MCP server
// bundles this file (via mcp-server/shared.ts) so save_opinion and save_plan
// keep artifacts the way Apply does.

// Big enough for any mockup, deck or screenshot; a stray link to a disk image
// or a video should not be silently duplicated into the card folder.
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

// Chat writes throwaway files here (see buildFileLinkRule); the sweep in
// lib/scratch-sweep.ts deletes it, never the card root.
export const SCRATCH_DIR = "scratch";

/**
 * A card's permanent folder: `~/.ideafy/images/<cardId>`. Chat attachments,
 * saved mockups and applied artifacts all live here, and the MCP server finds
 * the same folder without asking the app.
 */
export function cardArtifactDir(cardId: string, homeDir: string = homedir()): string {
  return path.join(homeDir, ".ideafy", "images", cardId);
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + path.sep);
}

function sameContents(a: string, b: string): boolean {
  const sa = statSync(a);
  const sb = statSync(b);
  if (sa.size !== sb.size) return false;
  return readFileSync(a).equals(readFileSync(b));
}

/**
 * Pick a destination named `base` inside `dir`. An existing file `isSame`
 * accepts is reused so applying the same message twice does not pile up
 * copies; a different file with the same name gets `-2`, `-3`, … before the
 * extension.
 */
export function destinationFor(base: string, dir: string, isSame: (candidate: string) => boolean): string {
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  for (let n = 1; ; n++) {
    const candidate = path.join(dir, n === 1 ? base : `${stem}-${n}${ext}`);
    if (!existsSync(candidate)) return candidate;
    if (isSame(candidate)) return candidate;
  }
}

function sameBytes(candidate: string, contents: Buffer): boolean {
  return statSync(candidate).size === contents.length && readFileSync(candidate).equals(contents);
}

/**
 * Chat-stream pass (IDE-397): save every closed ```html artifact="…" block in
 * a finished reply under the card's scratch/ folder and put a markdown link to
 * the file in its place. A revised mockup with the same name becomes `-2`, so
 * the link in an older message keeps opening the older version. Blocks still
 * open (an aborted turn), over the size cap or with an unusable name stay as
 * they are.
 */
export function materializeArtifactFences(text: string, cardDir: string): string {
  const fences = extractArtifactFences(text).filter((fence) => fence.closed);
  if (fences.length === 0) return text;

  const scratchDir = path.join(cardDir, SCRATCH_DIR);
  let out = "";
  let cursor = 0;
  for (const fence of fences) {
    out += text.slice(cursor, fence.start);
    cursor = fence.end;
    const original = text.slice(fence.start, fence.end);
    const contents = Buffer.from(fence.body.endsWith("\n") ? fence.body : `${fence.body}\n`, "utf8");
    if (!fence.filename || contents.length > ARTIFACT_FENCE_MAX_BYTES) {
      console.warn(`[artifact-fence] left a block in place: ${fence.filename ?? "bad name"}, ${contents.length} bytes`);
      out += original;
      continue;
    }
    try {
      mkdirSync(scratchDir, { recursive: true });
      const target = destinationFor(fence.filename, scratchDir, (candidate) => sameBytes(candidate, contents));
      if (!existsSync(target)) writeFileSync(target, contents);
      out += `[${path.basename(target)}](${pathToFileUrl(target)})`;
    } catch (error) {
      console.error("Failed to save artifact block:", fence.filename, error);
      out += original;
    }
  }
  return out + text.slice(cursor);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Apply-time pass: copy linked artifacts into the card folder, then store the
 * links as artifact chips.
 */
export function persistArtifacts(html: string, cardDir: string): string {
  return fileLinksToArtifactChips(persistArtifactLinks(html, cardDir));
}

/**
 * The save-time pass every write of an opinion or a plan runs — Apply in the
 * app, save_opinion and save_plan over MCP. A backticked path counts as a link
 * (that is how Claude usually names the file); every linked file outside the
 * card folder is copied in, and the links are stored as chips. The folder is
 * made first: persistArtifactLinks leaves everything alone when it is missing.
 */
export function persistCardArtifacts(html: string, cardId: string, homeDir: string = homedir()): string {
  const linked = codePathsToFileLinks(html, homeDir);
  if (!linked.includes("file://")) return linked;
  const cardDir = cardArtifactDir(cardId, homeDir);
  try {
    mkdirSync(cardDir, { recursive: true });
  } catch (error) {
    console.error("Failed to create the card folder:", cardDir, error);
  }
  return persistArtifacts(linked, cardDir);
}

/**
 * Copy every `file://` artifact linked from `html` into the card's permanent
 * folder and point the link at the copy. Chat artifacts are usually written
 * to `/var/folders/...` or `/tmp`, which macOS clears; the card folder
 * (`~/.ideafy/images/<cardId>`) survives trash/restore and backup import
 * because both keep the card id. Links that already point inside the folder
 * (outside its scratch/), or at a file that does not exist, are left as they
 * are.
 */
export function persistArtifactLinks(html: string, cardDir: string): string {
  if (!html || !html.includes("file://")) return html;

  let realCardDir: string;
  try {
    realCardDir = realpathSync(cardDir);
  } catch {
    return html;
  }

  return html.replace(/href=(["'])(file:\/\/[^"']*)\1/gi, (match, quote: string, rawHref: string) => {
    const source = fileUrlToPath(rawHref.replace(/&amp;/g, "&"));
    if (!source) return match;

    let realSource: string;
    try {
      realSource = realpathSync(source);
      const stat = statSync(realSource);
      if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) return match;
    } catch {
      return match;
    }
    // scratch/ is swept a week after the card completes; an applied file
    // there is approved now, so it moves up to the card root with the rest.
    if (isInside(realSource, realCardDir) && !isInside(realSource, path.join(realCardDir, SCRATCH_DIR))) {
      return match;
    }

    try {
      const target = destinationFor(artifactBasename(realSource), realCardDir, (candidate) =>
        sameContents(realSource, candidate),
      );
      if (!existsSync(target)) copyFileSync(realSource, target);
      return `href=${quote}${escapeAttr(pathToFileUrl(target))}${quote}`;
    } catch (error) {
      console.error("Failed to persist artifact:", source, error);
      return match;
    }
  });
}
