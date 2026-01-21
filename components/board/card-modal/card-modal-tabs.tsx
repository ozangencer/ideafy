"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionType, SECTION_CONFIG } from "@/lib/types";
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
}

export function CardModalTabs({ activeTab, onTabChange }: CardModalTabsProps) {
  return (
    <div className="shrink-0 border-b border-border px-4">
      <Tabs value={activeTab} onValueChange={(v) => onTabChange(v as SectionType)}>
        <TabsList className="h-10 bg-transparent gap-1 p-0">
          {(Object.keys(SECTION_CONFIG) as SectionType[]).map((section) => {
            const config = SECTION_CONFIG[section];
            const Icon = SECTION_ICONS[section];
            const isActive = activeTab === section;

            return (
              <TabsTrigger
                key={section}
                value={section}
                className={`
                  h-9 px-3 gap-2 rounded-md text-sm font-medium transition-colors
                  data-[state=active]:bg-muted data-[state=active]:text-foreground
                  data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-muted/50
                `}
              >
                <Icon
                  className="w-4 h-4"
                  style={{ color: isActive ? config.color : undefined }}
                />
                <span>{config.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
    </div>
  );
}
