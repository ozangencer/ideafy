import * as fs from "fs";
import * as path from "path";

/**
 * One line in a Work project's CLAUDE.md (or AGENTS.md) that points every run
 * at the brief's References list. The list itself stays in the brief, so the
 * two never drift apart; only the path is repeated here.
 *
 * The trailing HTML comment marks the line as ours: it is how a second add is
 * recognised and how a later brief-path change finds the line to rewrite. It
 * does not render in markdown views.
 */
export const BRIEF_POINTER_MARKER = "<!-- ideafy:brief-pointer -->";

const MARKED_LINE = /^.*<!-- ideafy:brief-pointer -->.*$/m;

export type BriefPointerFile = "CLAUDE.md" | "AGENTS.md";

export function briefPointerLine(narrativePath: string): string {
  return `Reference material is listed in \`${narrativePath}\` (References). Read the relevant ones before writing deliverables. ${BRIEF_POINTER_MARKER}`;
}

/**
 * Codex reads AGENTS.md, Claude reads CLAUDE.md. The folder decides rather
 * than the provider setting, since a card can override the provider: a folder
 * that only has AGENTS.md gets it there, everything else gets CLAUDE.md.
 * Never both, so no file the user does not use is created.
 */
export function pickPointerFile(folder: string): BriefPointerFile {
  const has = (name: string) => fs.existsSync(path.join(folder, name));
  return has("AGENTS.md") && !has("CLAUDE.md") ? "AGENTS.md" : "CLAUDE.md";
}

function readOrEmpty(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
}

/**
 * Appends the pointer to the end of the picked file, creating it if needed.
 * Nothing else in the file is touched. A file that already carries the marker,
 * or already names the brief path in a line the user wrote, is left alone.
 */
export function addBriefPointer(
  folder: string,
  narrativePath: string
): { result: "added" | "exists"; file: BriefPointerFile } {
  const file = pickPointerFile(folder);
  const target = path.join(folder, file);
  const content = readOrEmpty(target);

  if (content.includes(BRIEF_POINTER_MARKER) || content.includes(narrativePath)) {
    return { result: "exists", file };
  }

  const separator =
    content === "" || content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(target, `${content}${separator}${briefPointerLine(narrativePath)}\n`, "utf-8");
  return { result: "added", file };
}

/**
 * Rewrites the marked line in CLAUDE.md and AGENTS.md to point at a new brief
 * path. Files without the marker are not touched. Returns the files changed.
 */
export function retargetBriefPointer(folder: string, narrativePath: string): BriefPointerFile[] {
  const changed: BriefPointerFile[] = [];
  for (const file of ["CLAUDE.md", "AGENTS.md"] as const) {
    const target = path.join(folder, file);
    const content = readOrEmpty(target);
    if (!MARKED_LINE.test(content)) continue;

    const next = content.replace(MARKED_LINE, briefPointerLine(narrativePath));
    if (next === content) continue;
    fs.writeFileSync(target, next, "utf-8");
    changed.push(file);
  }
  return changed;
}
