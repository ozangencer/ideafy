"use client";

import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { SectionType, SECTION_CONFIG } from "@/lib/types";

interface SectionEditorProps {
  sectionType: SectionType;
  value: string;
  onChange: (value: string) => void;
  onCardClick?: (cardId: string) => void;
  projectId: string | null;
}

export function SectionEditor({
  sectionType,
  value,
  onChange,
  onCardClick,
  projectId,
}: SectionEditorProps) {
  const config = SECTION_CONFIG[sectionType];

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
