"use client";

import { FileOutput, LayoutTemplate } from "lucide-react";
import { Card, DEFAULT_WORK_TEMPLATES } from "@/lib/types";
import { resolveWorkTemplate } from "@/lib/work-templates";
import { useKanbanStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import { openArtifactChip } from "@/lib/open-path";
import { artifactBasename } from "@/lib/artifact-url";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface WorkCardBarProps {
  card: Card;
  /** The Detail tab is where the template is chosen; the outputs show on every tab. */
  showTemplate: boolean;
  readOnly: boolean;
}

/**
 * A Work card's strip above the editor: which template Generate will use, and
 * the files its runs recorded with save_output. The template is written
 * straight to the card rather than through the form, the way the worktree
 * switch is — it is a run setting, not text the auto-save should own.
 */
export function WorkCardBar({ card, showTemplate, readOnly }: WorkCardBarProps) {
  const templates = useKanbanStore((s) => s.settings?.workTemplates) ?? DEFAULT_WORK_TEMPLATES;
  const updateCard = useKanbanStore((s) => s.updateCard);
  const { toast } = useToast();

  const outputs = card.outputPaths ?? [];
  if (!showTemplate && outputs.length === 0) return null;

  const current = resolveWorkTemplate(templates, card.workTemplateId);

  return (
    <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border px-6 py-2 text-xs">
      {showTemplate && (
        <div className="flex items-center gap-2">
          <LayoutTemplate className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Template</span>
          <Select
            value={current.id}
            disabled={readOnly}
            onValueChange={(id) => void updateCard(card.id, { workTemplateId: id })}
          >
            <SelectTrigger className="h-7 w-auto min-w-[140px] gap-2 text-xs" aria-label="Work template">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[70]">
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  <span className="flex items-center gap-2">
                    {template.name}
                    <span className="font-mono text-current opacity-60">{template.outputExt}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {outputs.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <FileOutput className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Output</span>
          {outputs.map((relativePath) => (
            <button
              key={relativePath}
              type="button"
              title={relativePath}
              onClick={() => void openArtifactChip(card.id, relativePath, toast)}
              className="max-w-[260px] truncate rounded border border-border px-1.5 py-0.5 font-mono text-foreground transition-colors hover:bg-ink/[0.06]"
            >
              {artifactBasename(relativePath)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
