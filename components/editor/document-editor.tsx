"use client";

import { useMemo } from "react";
import { useKanbanStore } from "@/lib/store";
import { parseSimpleFrontmatter } from "@/lib/skills/frontmatter";
import { MarkdownViewerPanel } from "./markdown-viewer-panel";

function formatMetadataLabel(key: string): string {
  return key
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function DocumentEditor() {
  const {
    selectedDocument,
    documentContent,
    closeDocumentEditor,
    isDocumentEditorOpen,
  } = useKanbanStore();

  const parsed = useMemo(
    () => parseSimpleFrontmatter(documentContent ?? ""),
    [documentContent]
  );

  const frontmatterEntries = useMemo(
    () =>
      Object.entries(parsed.frontmatter).filter(
        ([, value]) => typeof value === "string" && value.trim() !== ""
      ),
    [parsed.frontmatter]
  );

  if (!isDocumentEditorOpen || !selectedDocument) return null;

  const hasFrontmatter = frontmatterEntries.length > 0;
  const content = hasFrontmatter ? parsed.bodyContent : documentContent;

  const preface = hasFrontmatter ? (
    <section className="rounded-xl border border-border bg-card/70 p-4 shadow-sm">
      <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
        Frontmatter
      </div>
      <div className="space-y-3">
        {frontmatterEntries.map(([key, value]) => (
          <div key={key} className="grid gap-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
              {formatMetadataLabel(key)}
            </div>
            <div className="text-sm leading-6 text-foreground/90">{value}</div>
          </div>
        ))}
      </div>
    </section>
  ) : null;

  return (
    <MarkdownViewerPanel
      title={selectedDocument.name}
      subtitle={selectedDocument.relativePath}
      content={content}
      path={selectedDocument.path}
      onClose={closeDocumentEditor}
      preface={preface}
    />
  );
}
