import type { DocumentFile, TreeNode } from "@/lib/types";

/**
 * Below this many characters a query matches inside nearly every document,
 * so the content layer stays quiet and the name filter carries the box.
 */
export const CONTENT_SEARCH_MIN_QUERY = 3;

/** Characters of context kept on either side of a hit. */
const SNIPPET_BEFORE = 50;
const SNIPPET_AFTER = 70;

/** A file whose text contains the query, with one excerpt showing why. */
export type ContentMatch = Pick<
  DocumentFile,
  "name" | "path" | "relativePath" | "isClaudeMd" | "source"
> & {
  matchCount: number;
  snippet: string;
};

export type ContentSearchResponse = {
  query: string;
  scannedFiles: number;
  elapsedMs: number;
  truncated: boolean;
  results: ContentMatch[];
};

/**
 * A file matches on its name or on the folders above it, so typing part of a
 * path narrows the tree the same way typing part of a filename does.
 *
 * A folder whose own name matches keeps its whole subtree: typing `docs` is a
 * request to see that folder, not to filter inside it. This mirrors
 * filterResolvedGroups in lib/skills/search.ts.
 *
 * Nodes are copied rather than mutated — the caller's tree is memoized.
 */
export function filterDocumentTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query) return nodes;

  return nodes.flatMap((node) => {
    if (node.type === "file") {
      const hit =
        node.name.toLowerCase().includes(query) ||
        node.path.toLowerCase().includes(query);
      return hit ? [node] : [];
    }

    if (node.name.toLowerCase().includes(query)) return [node];

    const children = filterDocumentTree(node.children, query);
    if (children.length === 0) return [];

    // The badge has to count what survived the filter, not what the folder holds.
    return [{ ...node, children, fileCount: countTreeFiles(children) }];
  });
}

export function countTreeFiles(nodes: TreeNode[]): number {
  return nodes.reduce(
    (total, node) =>
      total + (node.type === "file" ? 1 : countTreeFiles(node.children)),
    0
  );
}

/** Absolute paths of every file the tree is currently showing. */
export function collectTreeDocumentPaths(nodes: TreeNode[]): Set<string> {
  const paths = new Set<string>();

  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.type === "file") {
        if (node.document) paths.add(node.document.path);
      } else {
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return paths;
}

/**
 * Counts every hit but keeps only the first as an excerpt. In a 256px sidebar
 * a 120-character excerpt already runs three lines, so a second one costs more
 * room than the `×12` badge that says the same thing.
 */
export function findInContent(
  content: string,
  query: string
): { matchCount: number; snippet: string } | null {
  const haystack = content.toLowerCase();
  let cursor = 0;
  let matchCount = 0;
  let snippet = "";

  for (;;) {
    const at = haystack.indexOf(query, cursor);
    if (at === -1) break;

    if (matchCount === 0) {
      const start = Math.max(0, at - SNIPPET_BEFORE);
      const end = Math.min(content.length, at + query.length + SNIPPET_AFTER);
      // Collapsing runs of whitespace keeps a Markdown table or code fence from
      // spending the excerpt on line breaks. The query itself survives intact,
      // so HighlightedText can still find it.
      const body = content.slice(start, end).replace(/\s+/g, " ").trim();
      snippet = `${start > 0 ? "…" : ""}${body}${end < content.length ? "…" : ""}`;
    }

    matchCount += 1;
    cursor = at + query.length;
  }

  return matchCount > 0 ? { matchCount, snippet } : null;
}
