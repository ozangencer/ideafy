"use client";

import { useEffect, useRef } from "react";
import DOMPurify from "isomorphic-dompurify";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { openArtifactChip } from "@/lib/open-path";
import { codePathsToArtifactChips } from "@/lib/artifact-url";
import { useToast } from "@/hooks/use-toast";
import { checkArtifactPaths } from "@/hooks/use-artifact-available";
import { SectionType, SECTION_CONFIG } from "@/lib/types";
import { EnrichButton } from "./enrich-button";

/**
 * Autonomous runs store task items bare (`<li data-type="taskItem">text <code>…</code></li>`);
 * only the editor turns them into `<label><input/></label><div>…</div>`. The read-only
 * view renders the raw HTML, and taskItem `li`s are flex rows, so every text and
 * `<code>` node of a bare item became its own column with no checkbox. Give bare
 * items the editor's shape before rendering.
 */
function shapeTaskItemsForDisplay(html: string): string {
  if (!html.includes('data-type="taskItem"') || typeof document === "undefined") return html;
  const container = document.createElement("div");
  container.innerHTML = html;
  container.querySelectorAll('li[data-type="taskItem"]').forEach((item) => {
    if (item.querySelector(":scope > label")) return;
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.disabled = true;
    if (item.getAttribute("data-checked") === "true") checkbox.setAttribute("checked", "");
    label.appendChild(checkbox);
    const body = document.createElement("div");
    body.append(...Array.from(item.childNodes));
    item.append(label, body);
  });
  return container.innerHTML;
}

interface SectionEditorProps {
  sectionType: SectionType;
  value: string;
  onChange: (value: string) => void;
  onCardClick?: (cardId: string) => void;
  projectId: string | null;
  readOnly?: boolean;
  cardId?: string;
  /** Only read for drafts, which have no card row to take the platform from. */
  aiPlatform?: string | null;
}

export function SectionEditor({
  sectionType,
  value,
  onChange,
  onCardClick,
  projectId,
  readOnly,
  cardId,
  aiPlatform,
}: SectionEditorProps) {
  const config = SECTION_CONFIG[sectionType];
  const { toast } = useToast();
  const readOnlyRef = useRef<HTMLDivElement>(null);

  // DOMPurify default config preserves every tag/attr TipTap produces
  // (p, ul, li, table, img, code, blockquote, task-list classes …) while
  // stripping <script>, on* event handlers, and javascript: URLs.
  const sanitized =
    readOnly && value ? shapeTaskItemsForDisplay(codePathsToArtifactChips(DOMPurify.sanitize(value))) : "";

  // Chips whose file cannot be opened (outside the card's folders, or swept
  // from scratch/) are marked so they render faded and ignore clicks.
  useEffect(() => {
    const root = readOnlyRef.current;
    if (!root || !cardId || cardId.startsWith("draft-")) return;
    const chips = Array.from(root.querySelectorAll<HTMLElement>(".artifact-mention[data-path]"));
    const paths = Array.from(new Set(chips.map((chip) => chip.getAttribute("data-path")!)));
    if (paths.length === 0) return;
    let cancelled = false;
    void checkArtifactPaths(cardId, paths).then((available) => {
      if (cancelled) return;
      for (const chip of chips) {
        if (available[chip.getAttribute("data-path")!] === false) {
          chip.setAttribute("data-missing", "");
          chip.setAttribute("aria-disabled", "true");
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sanitized, cardId]);

  if (readOnly) {
    return (
      <div className="h-full flex flex-col p-4 overflow-hidden">
        <div
          ref={readOnlyRef}
          className="flex-1 min-h-0 overflow-y-auto prose-kanban"
          onClick={(event) => {
            const chip = (event.target as HTMLElement).closest(".artifact-mention") as HTMLElement | null;
            const filePath = chip?.getAttribute("data-path");
            if (!filePath || chip?.hasAttribute("data-missing")) return;
            event.preventDefault();
            void openArtifactChip(cardId, filePath, toast);
          }}
        >
          {sanitized ? (
            <div dangerouslySetInnerHTML={{ __html: sanitized }} />
          ) : (
            <p className="text-muted-foreground text-sm">No content</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      {/* Detail only. A draft has no card row for the server to read, so it
          sends the form's project and platform instead of its id. */}
      {sectionType === "detail" &&
        (cardId && !cardId.startsWith("draft-") ? (
          <EnrichButton cardId={cardId} value={value} onChange={onChange} />
        ) : (
          <EnrichButton
            projectId={projectId}
            aiPlatform={aiPlatform}
            value={value}
            onChange={onChange}
          />
        ))}
      <div className="flex-1 min-h-0 h-full overflow-y-auto section-editor-wrapper">
        <MarkdownEditor
          value={value}
          onChange={onChange}
          placeholder={config.placeholder}
          onCardClick={onCardClick}
          projectId={projectId}
          cardId={cardId}
          preferSelectionOnDrop
        />
      </div>
    </div>
  );
}
