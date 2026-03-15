"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CloudOff,
  X,
  FileText,
  Brain,
  Lightbulb,
  TestTube2,
} from "lucide-react";
import type { PoolCard } from "@/lib/team/types";
import { SectionType, SECTION_CONFIG } from "@/lib/types";

const SECTION_ICONS: Record<SectionType, typeof FileText> = {
  detail: FileText,
  opinion: Brain,
  solution: Lightbulb,
  tests: TestTube2,
};

export function hasContent(html: string | undefined): boolean {
  if (!html) return false;
  const text = html.replace(/<[^>]*>/g, "").trim();
  return text.length > 0;
}

export function PoolCardSlideOver({
  card,
  onClose,
  onRemove,
  isRemoving,
  getMemberName,
  statusColors,
  priorityColors,
}: {
  card: PoolCard;
  onClose: () => void;
  onRemove?: () => void;
  isRemoving?: boolean;
  getMemberName: (userId: string | undefined) => string | null;
  statusColors: Record<string, string>;
  priorityColors: Record<string, string>;
}) {
  const [activeTab, setActiveTab] = useState<SectionType>("detail");

  const pushedName = card.pushedByName || getMemberName(card.pushedBy) || "Unknown";
  const assignedName = card.assignedToName || getMemberName(card.assignedTo);
  const pulledName = card.pulledByName || getMemberName(card.pulledBy);

  const sectionValues: Record<SectionType, string> = {
    detail: card.description || "",
    opinion: card.aiOpinion || "",
    solution: card.solutionSummary || "",
    tests: card.testScenarios || "",
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border-l border-border w-full max-w-[900px] h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-border px-6 py-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pr-4">
              <h2 className="text-lg font-semibold truncate">{card.title}</h2>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${statusColors[card.status] || "bg-gray-400"}`} />
                  <span className="text-xs text-muted-foreground capitalize">
                    Status: <span className="text-foreground">{card.status}</span>
                  </span>
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${priorityColors[card.priority] || ""}`}>
                  Priority: {card.priority}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${
                  card.complexity === "hard" ? "text-red-500 bg-red-500/10" :
                  card.complexity === "medium" ? "text-yellow-500 bg-yellow-500/10" :
                  "text-green-500 bg-green-500/10"
                }`}>
                  Complexity: {card.complexity}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                {card.projectName && <span>Project: {card.projectName}</span>}
                <span>Pushed by {pushedName}</span>
                {assignedName && <span>Assigned to {assignedName}</span>}
                {pulledName && <span>Pulled by {pulledName}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {onRemove && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-muted-foreground hover:text-destructive"
                  onClick={onRemove}
                  disabled={isRemoving}
                >
                  <CloudOff className="h-3.5 w-3.5" />
                  <span className="text-xs">Remove from Pool</span>
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Section Tabs */}
        <div className="shrink-0 border-b border-border px-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SectionType)}>
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
                      data-[state=active]:bg-muted data-[state=active]:text-foreground
                      data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-muted/50
                    `}
                  >
                    <Icon
                      className="w-4 h-4"
                      style={{ color: isActive ? config.color : undefined }}
                    />
                    <span>{config.label}</span>
                    {isFilled && !isActive && (
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: config.color }}
                      />
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {hasContent(sectionValues[activeTab]) ? (
            <div className="prose-kanban">
              <div
                dangerouslySetInnerHTML={{ __html: sectionValues[activeTab] }}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No {SECTION_CONFIG[activeTab].label.toLowerCase()} content
            </div>
          )}

          {/* AI Verdict badge for opinion tab */}
          {activeTab === "opinion" && card.aiVerdict && (
            <div className="mt-4 pt-4 border-t border-border">
              <span className={`text-xs font-medium px-2 py-1 rounded ${
                card.aiVerdict === "pass"
                  ? "text-green-500 bg-green-500/10"
                  : card.aiVerdict === "fail"
                    ? "text-red-500 bg-red-500/10"
                    : "text-yellow-500 bg-yellow-500/10"
              }`}>
                Verdict: {card.aiVerdict}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
