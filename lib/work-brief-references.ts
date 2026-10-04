// The References question of the Work brief is a picked list, not free text.
// It still travels to the narrative route as a markdown list in
// WorkBriefData.references, so the prompt and route do not change.

export type ReferenceKind = "file" | "folder" | "link";

export interface BriefReference {
  /** Relative to the project folder when inside it, absolute when outside, a URL for links. */
  path: string;
  kind: ReferenceKind;
  outside: boolean;
  note: string;
}

function trimTrailingSlashes(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

/**
 * Turn an absolute path from a drop or the file picker into a reference.
 * Paths inside the project folder are kept relative; the folder itself is
 * not a reference and returns null.
 */
export function referenceFromPath(
  absolutePath: string,
  folderPath: string,
  kind: "file" | "folder",
): BriefReference | null {
  const target = trimTrailingSlashes(absolutePath.trim());
  const base = trimTrailingSlashes(folderPath.trim());
  if (!target || target === base) return null;
  const inside = target.startsWith(`${base}/`);
  return {
    path: inside ? target.slice(base.length + 1) : target,
    kind,
    outside: !inside,
    note: "",
  };
}

/** Accept a pasted http(s) link; anything else returns null. */
export function referenceFromLink(raw: string): BriefReference | null {
  const value = raw.trim();
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { path: value, kind: "link", outside: false, note: "" };
}

/** Show a home-relative path with ~, the way Finder users read it. */
export function displayReferencePath(ref: BriefReference, home: string | null): string {
  if (ref.kind === "link") return ref.path;
  const shown = home && ref.outside && ref.path.startsWith(`${home}/`)
    ? `~${ref.path.slice(home.length)}`
    : ref.path;
  return ref.kind === "folder" ? `${shown}/` : shown;
}

/** The markdown list posted as WorkBriefData.references. */
export function serializeReferences(refs: BriefReference[]): string {
  return refs
    .map((ref) => {
      const label = ref.kind === "folder" ? `${ref.path}/` : ref.path;
      const where = ref.outside ? " (outside the project folder)" : "";
      const note = ref.note.trim();
      return `- ${label}${where}${note ? `: ${note}` : ""}`;
    })
    .join("\n");
}
