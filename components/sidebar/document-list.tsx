"use client";

import { useMemo, useState } from "react";
import { useKanbanStore } from "@/lib/store";
import { DocumentFile, TreeNode } from "@/lib/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { FileText, File, ChevronRight, FolderOpen, Folder } from "lucide-react";

// Build tree structure from flat document list
function buildTree(documents: DocumentFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folderMap = new Map<string, TreeNode>();

  // Sort documents by relativePath for consistent ordering
  const sortedDocs = [...documents].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  );

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

  function sortTree(nodes: TreeNode[]): TreeNode[] {
    const sorted = sortNodes(nodes);
    for (const node of sorted) {
      if (node.type === "folder") {
        node.children = sortTree(node.children);
      }
    }
    return sorted;
  }

  return sortTree(root);
}

// File item component
function FileItem({
  node,
  depth,
  selectedDocument,
  openDocument,
}: {
  node: TreeNode;
  depth: number;
  selectedDocument: DocumentFile | null;
  openDocument: (doc: DocumentFile) => Promise<void>;
}) {
  if (!node.document) return null;

  const isSelected = selectedDocument?.path === node.document.path;
  const isClaudeMd = node.document.isClaudeMd;

  return (
    <button
      onClick={() => openDocument(node.document!)}
      className={`w-full text-left py-2 rounded-md text-sm transition-colors flex items-center gap-2 ${
        isSelected
          ? "bg-[#fafaf9] text-[#0a0a0a] font-medium border-l-2 border-[#0a0a0a]"
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
        {node.name}
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
}: {
  node: TreeNode;
  depth: number;
  expandedDocFolders: string[];
  toggleDocFolder: (path: string) => void;
  selectedDocument: DocumentFile | null;
  openDocument: (doc: DocumentFile) => Promise<void>;
}) {
  const isExpanded = expandedDocFolders.includes(node.path);

  return (
    <Collapsible open={isExpanded} onOpenChange={() => toggleDocFolder(node.path)}>
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
        <span>{node.name}</span>
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
}: {
  node: TreeNode;
  depth: number;
  expandedDocFolders: string[];
  toggleDocFolder: (path: string) => void;
  selectedDocument: DocumentFile | null;
  openDocument: (doc: DocumentFile) => Promise<void>;
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
      />
    );
  }

  return (
    <FileItem
      node={node}
      depth={depth}
      selectedDocument={selectedDocument}
      openDocument={openDocument}
    />
  );
}

export function DocumentList() {
  const {
    documents,
    openDocument,
    selectedDocument,
    expandedDocFolders,
    toggleDocFolder,
  } = useKanbanStore();
  const [isOpen, setIsOpen] = useState(true);

  // Build tree from flat document list
  const tree = useMemo(() => buildTree(documents), [documents]);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="px-2 relative z-0">
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
            {documents.length}
          </span>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-1 space-y-0.5">
        {documents.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-2">
            No documents found
          </p>
        ) : (
          tree.map((node) => (
            <TreeNodeComponent
              key={node.path}
              node={node}
              depth={0}
              expandedDocFolders={expandedDocFolders}
              toggleDocFolder={toggleDocFolder}
              selectedDocument={selectedDocument}
              openDocument={openDocument}
            />
          ))
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
