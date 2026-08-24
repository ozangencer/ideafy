"use client";

import { useEffect, useMemo, useState } from "react";
import { useKanbanStore } from "@/lib/store";
import { DocumentFile, TreeNode } from "@/lib/types";
import {
  CONTENT_SEARCH_MIN_QUERY,
  collectTreeDocumentPaths,
  countTreeFiles,
  filterDocumentTree,
  type ContentMatch,
  type ContentSearchResponse,
} from "@/lib/documents/search";
import { normalizeSearchQuery } from "@/lib/skills/search";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { HighlightedText, SidebarSearchInput } from "./sidebar-search-input";
import { FileText, File, ChevronRight, FolderOpen, Folder } from "lucide-react";

/** How long the box waits after the last keystroke before asking the server. */
const CONTENT_SEARCH_DEBOUNCE_MS = 250;

type ContentState = {
  status: "idle" | "loading" | "done";
  results: ContentMatch[];
  truncated: boolean;
};

const IDLE_CONTENT: ContentState = { status: "idle", results: [], truncated: false };

type TopLevelOrder = "alphabetical" | "preserved";

// Build tree structure from flat document list
function buildTree(
  documents: DocumentFile[],
  topLevelOrder: TopLevelOrder = "alphabetical"
): TreeNode[] {
  const root: TreeNode[] = [];
  const folderMap = new Map<string, TreeNode>();

  // Track first-appearance index of top-level names (for preserved order)
  const topLevelOrderMap = new Map<string, number>();
  documents.forEach((doc, idx) => {
    const top = doc.relativePath.split("/")[0];
    if (!topLevelOrderMap.has(top)) topLevelOrderMap.set(top, idx);
  });

  // Iterate in user order when preserving; alphabetical otherwise
  const sortedDocs =
    topLevelOrder === "preserved"
      ? documents
      : [...documents].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  for (const doc of sortedDocs) {
    const parts = doc.relativePath.split("/");

    if (parts.length === 1) {
      // Root level file
      root.push({
        name: doc.name,
        type: "file",
        path: doc.relativePath,
        document: doc,
        children: [],
        fileCount: 1,
      });
    } else {
      // Nested file - ensure all parent folders exist
      let currentPath = "";
      let parentChildren = root;

      for (let i = 0; i < parts.length - 1; i++) {
        const folderName = parts[i];
        currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;
        const folderPath = `${currentPath}/`;

        let folderNode = folderMap.get(folderPath);

        if (!folderNode) {
          folderNode = {
            name: folderName,
            type: "folder",
            path: folderPath,
            children: [],
            fileCount: 0,
          };
          folderMap.set(folderPath, folderNode);
          parentChildren.push(folderNode);
        }

        parentChildren = folderNode.children;
      }

      // Add the file to the deepest folder
      const fileName = parts[parts.length - 1];
      parentChildren.push({
        name: fileName,
        type: "file",
        path: doc.relativePath,
        document: doc,
        children: [],
        fileCount: 1,
      });
    }
  }

  // Calculate file counts for each folder
  function calculateFileCount(node: TreeNode): number {
    if (node.type === "file") {
      return 1;
    }
    let count = 0;
    for (const child of node.children) {
      count += calculateFileCount(child);
    }
    node.fileCount = count;
    return count;
  }

  for (const node of root) {
    calculateFileCount(node);
  }

  // Sort: CLAUDE.md first, then folders, then files (alphabetically within each group)
  function sortNodes(nodes: TreeNode[]): TreeNode[] {
    return nodes.sort((a, b) => {
      // CLAUDE.md always first
      if (a.document?.isClaudeMd) return -1;
      if (b.document?.isClaudeMd) return 1;
      // Folders before files
      if (a.type === "folder" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "folder") return 1;
      // Alphabetical within same type
      return a.name.localeCompare(b.name);
    });
  }

  function sortTopLevelPreserved(nodes: TreeNode[]): TreeNode[] {
    return nodes.sort((a, b) => {
      const aOrder = topLevelOrderMap.get(a.name) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = topLevelOrderMap.get(b.name) ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    });
  }

  function sortTree(nodes: TreeNode[], isRoot: boolean): TreeNode[] {
    const sorted =
      isRoot && topLevelOrder === "preserved"
        ? sortTopLevelPreserved(nodes)
        : sortNodes(nodes);
    for (const node of sorted) {
      if (node.type === "folder") {
        node.children = sortTree(node.children, false);
      }
    }
    return sorted;
  }

  return sortTree(root, true);
}

// File item component
function FileItem({
  node,
  depth,
  selectedDocument,
  openDocument,
  query,
}: {
  node: TreeNode;
  depth: number;
  selectedDocument: DocumentFile | null;
  openDocument: (doc: DocumentFile) => Promise<void>;
  query: string;
}) {
  if (!node.document) return null;

  const isSelected = selectedDocument?.path === node.document.path;
  const isClaudeMd = node.document.isClaudeMd;

  return (
    <button
      onClick={() => openDocument(node.document!)}
      className={`w-full text-left py-2 rounded-md text-sm transition-colors flex items-center gap-2 ${
        isSelected
          ? "bg-paper-cream text-ink font-medium border-l-2 border-ink"
          : isClaudeMd
            ? "text-foreground hover:bg-muted"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
      style={{ paddingLeft: `${depth * 16 + 12}px`, paddingRight: "12px" }}
    >
      {isClaudeMd ? (
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      ) : (
        <File className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className={`break-all ${isClaudeMd ? "font-medium" : ""}`}>
        <HighlightedText text={node.name} query={query} />
      </span>
    </button>
  );
}

// Folder item component
function FolderItem({
  node,
  depth,
  expandedDocFolders,
  toggleDocFolder,
  selectedDocument,
  openDocument,
  query,
  forceOpen,
}: {
  node: TreeNode;
  depth: number;
  expandedDocFolders: string[];
  toggleDocFolder: (path: string) => void;
  selectedDocument: DocumentFile | null;
  openDocument: (doc: DocumentFile) => Promise<void>;
  query: string;
  forceOpen: boolean;
}) {
  // While filtering, a match hidden inside a collapsed folder reads as a broken
  // search — so every folder opens. The toggle is suppressed for the same
  // reason in reverse: a click during the search must not rewrite the collapse
  // state the user gets back when the box is cleared.
  const isExpanded = forceOpen || expandedDocFolders.includes(node.path);

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={() => {
        if (forceOpen) return;
        toggleDocFolder(node.path);
      }}
    >
      <CollapsibleTrigger
        className="flex items-center gap-2 w-full py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        style={{ paddingLeft: `${depth * 16 + 12}px`, paddingRight: "12px" }}
      >
        <ChevronRight
          className={`h-3 w-3 transition-transform duration-200 ${
            isExpanded ? "rotate-90" : ""
          }`}
        />
        <Folder className="h-3.5 w-3.5 shrink-0" />
        <span>
          <HighlightedText text={node.name} query={query} />
        </span>
        <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded ml-auto">
          {node.fileCount}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-0.5">
        {node.children.map((child) => (
          <TreeNodeComponent
            key={child.path}
            node={child}
            depth={depth + 1}
            expandedDocFolders={expandedDocFolders}
            toggleDocFolder={toggleDocFolder}
            selectedDocument={selectedDocument}
            openDocument={openDocument}
            query={query}
            forceOpen={forceOpen}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

// Recursive tree node component
function TreeNodeComponent({
  node,
  depth,
  expandedDocFolders,
  toggleDocFolder,
  selectedDocument,
  openDocument,
  query,
  forceOpen,
}: {
  node: TreeNode;
  depth: number;
  expandedDocFolders: string[];
  toggleDocFolder: (path: string) => void;
  selectedDocument: DocumentFile | null;
  openDocument: (doc: DocumentFile) => Promise<void>;
  query: string;
  forceOpen: boolean;
}) {
  if (node.type === "folder") {
    return (
      <FolderItem
        node={node}
        depth={depth}
        expandedDocFolders={expandedDocFolders}
        toggleDocFolder={toggleDocFolder}
        selectedDocument={selectedDocument}
        openDocument={openDocument}
        query={query}
        forceOpen={forceOpen}
      />
    );
  }

  return (
    <FileItem
      node={node}
      depth={depth}
      selectedDocument={selectedDocument}
      openDocument={openDocument}
      query={query}
    />
  );
}

/**
 * A file whose text matched but whose name did not. Files already standing in
 * the tree above are filtered out before this renders, so a hit never appears
 * twice.
 */
function ContentHit({
  match,
  query,
  selectedDocument,
  openDocument,
}: {
  match: ContentMatch;
  query: string;
  selectedDocument: DocumentFile | null;
  openDocument: (doc: DocumentFile) => Promise<void>;
}) {
  const isSelected = selectedDocument?.path === match.path;

  return (
    <button
      onClick={() =>
        openDocument({
          name: match.name,
          path: match.path,
          relativePath: match.relativePath,
          isClaudeMd: match.isClaudeMd,
          source: match.source,
        })
      }
      className={`w-full rounded-md px-3 py-1.5 text-left transition-colors ${
        isSelected ? "bg-paper-cream" : "hover:bg-muted"
      }`}
    >
      <span className="flex items-baseline gap-1.5">
        <span className="min-w-0 break-all text-[13px] font-medium leading-[1.15rem] text-foreground/90">
          <HighlightedText text={match.name} query={query} />
        </span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          ×{match.matchCount}
        </span>
      </span>
      <span className="mt-[1px] block break-all text-[10px] text-muted-foreground/70">
        {match.relativePath}
      </span>
      <span
        className="mt-1 block text-[11px] leading-[0.95rem] text-muted-foreground/85"
        style={{ overflowWrap: "anywhere" }}
      >
        <HighlightedText text={match.snippet} query={query} />
      </span>
    </button>
  );
}

export function DocumentList() {
  const {
    documents,
    openDocument,
    selectedDocument,
    expandedDocFolders,
    toggleDocFolder,
    activeProjectId,
  } = useKanbanStore();
  const [isOpen, setIsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [content, setContent] = useState<ContentState>(IDLE_CONTENT);
  const query = normalizeSearchQuery(searchValue);

  // Split by source: custom (user-specified) comes first, discovered fills gaps
  const { customTree, discoveredTree } = useMemo(() => {
    const customDocs = documents.filter((d) => d.source === "custom");
    const discoveredDocs = documents.filter((d) => d.source !== "custom");
    return {
      customTree: buildTree(customDocs, "preserved"),
      discoveredTree: buildTree(discoveredDocs, "alphabetical"),
    };
  }, [documents]);

  const filteredCustomTree = useMemo(
    () => filterDocumentTree(customTree, query),
    [customTree, query]
  );
  const filteredDiscoveredTree = useMemo(
    () => filterDocumentTree(discoveredTree, query),
    [discoveredTree, query]
  );

  const nameMatchCount =
    countTreeFiles(filteredCustomTree) + countTreeFiles(filteredDiscoveredTree);

  // The content layer only reports what the tree is not already showing.
  const visiblePaths = useMemo(() => {
    const paths = collectTreeDocumentPaths(filteredCustomTree);
    collectTreeDocumentPaths(filteredDiscoveredTree).forEach((p) => paths.add(p));
    return paths;
  }, [filteredCustomTree, filteredDiscoveredTree]);

  const contentOnly = useMemo(
    () => content.results.filter((match) => !visiblePaths.has(match.path)),
    [content.results, visiblePaths]
  );

  // The name filter is free and runs on every keystroke; the content search is
  // a request, so it waits out the typing. Aborting on cleanup keeps a slow
  // earlier response from landing on top of a newer query.
  useEffect(() => {
    if (!isOpen || !activeProjectId || query.length < CONTENT_SEARCH_MIN_QUERY) {
      setContent(IDLE_CONTENT);
      return;
    }

    // Dropping the old hits rather than keeping them under a new query: a
    // snippet cut around "work" has nothing to highlight once you have typed
    // "workt", and a pasted query would leave results from a different search.
    setContent({ status: "loading", results: [], truncated: false });

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/projects/${activeProjectId}/documents/search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );
        const data: ContentSearchResponse = await response.json();
        setContent({
          status: "done",
          results: Array.isArray(data.results) ? data.results : [],
          truncated: Boolean(data.truncated),
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        console.error("Failed to search document contents:", error);
        setContent({ status: "done", results: [], truncated: false });
      }
    }, CONTENT_SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeProjectId, isOpen, query]);

  const hasCustom = filteredCustomTree.length > 0;
  const hasDiscovered = filteredDiscoveredTree.length > 0;
  const belowContentThreshold =
    query.length > 0 && query.length < CONTENT_SEARCH_MIN_QUERY;
  const matchCount = nameMatchCount + contentOnly.length;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        // A stale filter waiting behind a closed section reads as a bug when
        // the section is reopened.
        if (!open) setSearchValue("");
      }}
      className="px-2 relative z-0"
    >
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-2 py-2 text-xs text-muted-foreground uppercase tracking-wider font-medium hover:text-foreground transition-colors">
        <ChevronRight
          className={`h-3 w-3 transition-transform duration-200 ${
            isOpen ? "rotate-90" : ""
          }`}
        />
        <FolderOpen className="h-3.5 w-3.5" />
        <span>Documents</span>
        {documents.length > 0 && (
          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded normal-case">
            {query ? `${matchCount} / ${documents.length}` : documents.length}
          </span>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-1 space-y-0.5">
        {documents.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-2">
            No documents found
          </p>
        ) : (
          <>
            {/* No SEARCH_MIN_ITEMS threshold here, unlike the other sidebar
                sections. Theirs answers "is this list too long to scan", and
                for a name filter that is the whole question. Most of the value
                here is reading inside the files, which does not scale with how
                many there are: six documents can hold a hundred kilobytes of
                text worth searching. */}
            <SidebarSearchInput
              value={searchValue}
              onChange={setSearchValue}
              placeholder="Search documents..."
            />

            {filteredCustomTree.map((node) => (
              <TreeNodeComponent
                key={`custom:${node.path}`}
                node={node}
                depth={0}
                expandedDocFolders={expandedDocFolders}
                toggleDocFolder={toggleDocFolder}
                selectedDocument={selectedDocument}
                openDocument={openDocument}
                query={query}
                forceOpen={query.length > 0}
              />
            ))}
            {hasCustom && hasDiscovered && (
              <div className="my-1 border-t border-border/50" />
            )}
            {filteredDiscoveredTree.map((node) => (
              <TreeNodeComponent
                key={`discovered:${node.path}`}
                node={node}
                depth={0}
                expandedDocFolders={expandedDocFolders}
                toggleDocFolder={toggleDocFolder}
                selectedDocument={selectedDocument}
                openDocument={openDocument}
                query={query}
                forceOpen={query.length > 0}
              />
            ))}

            {contentOnly.length > 0 && (
              <>
                {nameMatchCount > 0 && (
                  <div className="my-1 border-t border-border/50" />
                )}
                <div className="flex items-center gap-2 px-3 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/65">
                  <span>In content</span>
                  <span className="ml-auto tracking-normal">{contentOnly.length}</span>
                </div>
                {contentOnly.map((match) => (
                  <ContentHit
                    key={match.path}
                    match={match}
                    query={query}
                    selectedDocument={selectedDocument}
                    openDocument={openDocument}
                  />
                ))}
                {content.truncated && (
                  <div className="px-3 py-1 text-[11px] text-muted-foreground/70">
                    Showing the first matches only.
                  </div>
                )}
              </>
            )}

            {content.status === "loading" && (
              <div className="px-3 py-2 text-[12px] leading-[1.2rem] text-muted-foreground/70">
                Searching contents…
              </div>
            )}

            {belowContentThreshold && nameMatchCount === 0 && (
              <div className="px-3 py-2 text-[12px] leading-[1.2rem] text-muted-foreground/70">
                Type {CONTENT_SEARCH_MIN_QUERY} characters to search inside
                documents.
              </div>
            )}

            {query.length > 0 &&
              matchCount === 0 &&
              content.status === "done" && (
                <div className="px-3 py-2 text-[12px] leading-[1.2rem] text-muted-foreground/70">
                  No documents match &ldquo;{searchValue.trim()}&rdquo;.
                </div>
              )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
