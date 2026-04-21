"use client";

import { useKanbanStore } from "@/lib/store";
import { MarkdownViewerPanel } from "./markdown-viewer-panel";

export function SkillViewer() {
  const { selectedSkill, isSkillViewerOpen, closeSkillViewer } = useKanbanStore();

  if (!isSkillViewerOpen || !selectedSkill) return null;

  const subtitleParts = [`/${selectedSkill.name}`];
  if (selectedSkill.group) subtitleParts.push(selectedSkill.group);
  if (selectedSkill.source === "project") subtitleParts.push("Project skill");

  return (
    <MarkdownViewerPanel
      title={selectedSkill.title}
      subtitle={subtitleParts.join(" • ")}
      content={selectedSkill.content}
      path={selectedSkill.path}
      onClose={closeSkillViewer}
    />
  );
}
