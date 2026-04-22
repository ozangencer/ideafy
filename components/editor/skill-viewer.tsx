"use client";

import { useKanbanStore } from "@/lib/store";
import { MarkdownViewerPanel } from "./markdown-viewer-panel";

function formatMetadataLabel(key: string): string {
  return key
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function SkillViewer() {
  const { selectedSkill, isSkillViewerOpen, closeSkillViewer } = useKanbanStore();

  if (!isSkillViewerOpen || !selectedSkill) return null;

  const subtitleParts = [`/${selectedSkill.name}`];
  if (selectedSkill.group) subtitleParts.push(selectedSkill.group);
  if (selectedSkill.source === "project") subtitleParts.push("Project skill");

  const frontmatterEntries = Object.entries(selectedSkill.frontmatter)
    .filter(([, value]) => typeof value === "string" && value.trim() !== "");

  const metadataEntries = (
    frontmatterEntries.length > 0
      ? frontmatterEntries
      : [["name", selectedSkill.name]]
  ).map(([key, value]) => ({
    label: formatMetadataLabel(key),
    value,
  }));

  return (
    <MarkdownViewerPanel
      title={selectedSkill.title}
      subtitle={subtitleParts.join(" • ")}
      content={selectedSkill.bodyContent}
      path={selectedSkill.path}
      onClose={closeSkillViewer}
      preface={
        metadataEntries.length > 0 ? (
          <section className="rounded-xl border border-border bg-card/70 p-4 shadow-sm">
            <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
              Skill Metadata
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
