"use client";

import DOMPurify from "isomorphic-dompurify";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { SectionType, SECTION_CONFIG } from "@/lib/types";

interface SectionEditorProps {
  sectionType: SectionType;
  value: string;
  onChange: (value: string) => void;
  onCardClick?: (cardId: string) => void;
  projectId: string | null;
  readOnly?: boolean;
}

export function SectionEditor({
  sectionType,
  value,
  onChange,
  onCardClick,
  projectId,
  readOnly,
}: SectionEditorProps) {
  const config = SECTION_CONFIG[sectionType];

  if (readOnly) {
    // DOMPurify default config preserves every tag/attr TipTap produces
    // (p, ul, li, table, img, code, blockquote, task-list classes …) while
    // stripping <script>, on* event handlers, and javascript: URLs.
    const sanitized = value ? DOMPurify.sanitize(value) : "";
    return (
      <div className="h-full flex flex-col p-4 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto prose-kanban">
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
      <div className="flex-1 min-h-0 overflow-y-auto section-editor-wrapper">
        <MarkdownEditor
          value={value}
          onChange={onChange}
          placeholder={config.placeholder}
          onCardClick={onCardClick}
          projectId={projectId}
        />
      </div>
    </div>
  );
}
