"use client";

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
    return (
      <div className="h-full flex flex-col p-4 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto prose-kanban">
          {value ? (
            <div dangerouslySetInnerHTML={{ __html: value }} />
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
