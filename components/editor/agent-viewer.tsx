"use client";

import { useKanbanStore } from "@/lib/store";
import { MarkdownViewerPanel } from "./markdown-viewer-panel";

function formatMetadataLabel(key: string): string {
  return key
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function AgentViewer() {
  const { selectedAgent, isAgentViewerOpen, closeAgentViewer } = useKanbanStore();

  if (!isAgentViewerOpen || !selectedAgent) return null;

  const subtitleParts = [`/${selectedAgent.name}`];
  subtitleParts.push(selectedAgent.format === "toml" ? "TOML agent" : "Markdown agent");
  if (selectedAgent.source === "project") subtitleParts.push("Project agent");

  const frontmatterEntries = Object.entries(selectedAgent.frontmatter)
    .filter(([, value]) => typeof value === "string" && value.trim() !== "");

  const metadataEntries = (
    frontmatterEntries.length > 0
      ? frontmatterEntries
      : [
          ["name", selectedAgent.name],
          ["format", selectedAgent.format.toUpperCase()],
        ]
  ).map(([key, value]) => ({
    label: formatMetadataLabel(key),
    value,
  }));

  return (
    <MarkdownViewerPanel
      title={selectedAgent.title}
      subtitle={subtitleParts.join(" • ")}
      content={selectedAgent.bodyContent}
      path={selectedAgent.path}
      onClose={closeAgentViewer}
      preface={
        metadataEntries.length > 0 ? (
          <section className="rounded-xl border border-border bg-card/70 p-4 shadow-sm">
            <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
              Agent Metadata
            </div>
            <div className="space-y-3">
              {metadataEntries.map((entry) => (
                <div key={entry.label} className="grid gap-1">
                  <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                    {entry.label}
                  </div>
                  <div className="text-sm leading-6 text-foreground/90">
                    {entry.value}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null
      }
    />
  );
}
