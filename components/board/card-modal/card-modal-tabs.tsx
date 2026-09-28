"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjectMode, SectionType, SECTION_CONFIG } from "@/lib/types";
import { hasContent } from "@/lib/card-initial-tab";
import { FileText, Brain, Lightbulb, TestTube2 } from "lucide-react";

const SECTION_ICONS: Record<SectionType, typeof FileText> = {
  detail: FileText,
  opinion: Brain,
  solution: Lightbulb,
  tests: TestTube2,
};

interface CardModalTabsProps {
  activeTab: SectionType;
  onTabChange: (tab: SectionType) => void;
  sectionValues: Record<SectionType, string>;
  mode?: ProjectMode;
}

// A Work card is reviewed, not tested. Only the tab's name changes: the content
// keeps its core-flow heading, which is what the progress badge reads.
const WORK_SECTION_LABELS: Partial<Record<SectionType, string>> = {
  tests: "Review checklist",
};

export function CardModalTabs({ activeTab, onTabChange, sectionValues, mode }: CardModalTabsProps) {
  return (
    <div className="shrink-0 border-b border-border px-4">
      <Tabs value={activeTab} onValueChange={(v) => onTabChange(v as SectionType)}>
        <TabsList className="h-10 bg-transparent gap-1 p-0">
          {(Object.keys(SECTION_CONFIG) as SectionType[]).map((section) => {
            const config = SECTION_CONFIG[section];
            const Icon = SECTION_ICONS[section];
            const isActive = activeTab === section;
            const isFilled = hasContent(sectionValues[section]);

            return (
              <TabsTrigger
                key={section}
                value={section}
                className={`
                  h-9 px-3 gap-2 rounded-md text-sm font-medium transition-colors
                  data-[state=active]:bg-primary/10 data-[state=active]:text-foreground
                  data-[state=inactive]:text-muted-foreground
                  data-[state=inactive]:hover:bg-foreground/[0.04] data-[state=inactive]:hover:text-foreground
                `}
              >
                <Icon
                  className={`w-4 h-4 ${isActive ? "text-primary" : ""}`}
                />
                <span>
                  {(mode === "work" && WORK_SECTION_LABELS[section]) || config.label}
                </span>
                {isFilled && !isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
    </div>
  );
}
