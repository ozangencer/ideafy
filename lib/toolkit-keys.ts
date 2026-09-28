import type { ToolkitItem, ToolkitKind } from "./types";

// Client-safe helpers for matching catalog entries against a project's
// Toolkit. The key splits on the first ":" only, because plugin names carry
// one of their own ("ideafy:ideafy-workflow").

export function toolkitKey(kind: ToolkitKind, name: string): string {
  return `${kind}:${name}`;
}

export function parseToolkitKey(key: string): { kind: ToolkitKind; name: string } | null {
  const i = key.indexOf(":");
  if (i === -1) return null;
  const kind = key.slice(0, i);
  if (kind !== "skill" && kind !== "agent") return null;
  return { kind, name: key.slice(i + 1) };
}

export function isPinned(items: ToolkitItem[], kind: ToolkitKind, name: string): boolean {
  return items.some((item) => item.kind === kind && item.name === name);
}

const FOLDER_NAME_MAX = 40;

/** Whitespace-collapsed and length-capped; an empty name means "no folder". */
export function normalizeToolkitFolder(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ").slice(0, FOLDER_NAME_MAX).trim();
  return name || null;
}

export type ToolkitFolderGroup = { folder: string | null; items: ToolkitItem[] };

/**
 * The order the Toolkit is shown in, in the sidebar and the `/` picker alike:
 * pins without a folder first, then one group per folder alphabetically, each
 * keeping pin order inside.
 */
export function groupToolkitByFolder(items: ToolkitItem[]): ToolkitFolderGroup[] {
  const loose: ToolkitItem[] = [];
  const byFolder = new Map<string, ToolkitItem[]>();
  for (const item of items) {
    if (!item.folder) {
      loose.push(item);
      continue;
    }
    const list = byFolder.get(item.folder) ?? [];
    list.push(item);
    byFolder.set(item.folder, list);
  }
  const folders = Array.from(byFolder.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  return [
    ...(loose.length ? [{ folder: null, items: loose }] : []),
    ...folders.map((folder) => ({ folder, items: byFolder.get(folder)! })),
  ];
}

export function toolkitFolderNames(items: ToolkitItem[]): string[] {
  return groupToolkitByFolder(items)
    .map((group) => group.folder)
    .filter((folder): folder is string => !!folder);
}
