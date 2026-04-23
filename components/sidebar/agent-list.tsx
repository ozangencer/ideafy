"use client";

import { useMemo, useState } from "react";
import { useKanbanStore } from "@/lib/store";
import type { AgentListItem } from "@/lib/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, Bot, Check, Copy, FileText } from "lucide-react";

type AgentSection = {
  label: string;
  items: AgentListItem[];
};

function dedupeAgentItems(items: AgentListItem[]): AgentListItem[] {
  const deduped = new Map<string, AgentListItem>();
  items.forEach((item) => {
    if (!deduped.has(item.name)) {
      deduped.set(item.name, item);
    }
  });
  return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function AgentList() {
  const {
    agents,
    projectAgents,
    agentItems,
    projectAgentItems,
    selectedAgent,
    openAgentPreview,
  } = useKanbanStore();
  const [copiedAgent, setCopiedAgent] = useState<string | null>(null);

  const globalItems = useMemo(() => {
    const items = dedupeAgentItems(agentItems);
    const names = Array.from(new Set(agents)).sort();

    names.forEach((name) => {
      if (!items.find((item) => item.name === name)) {
        items.push({
          name,
          title: name,
          path: "",
          description: null,
          source: "global",
          format: "md",
        });
      }
    });

    return items.sort((a, b) => a.name.localeCompare(b.name));
  }, [agentItems, agents]);

  const scopedProjectItems = useMemo(() => {
    const items = dedupeAgentItems(projectAgentItems);
    const names = Array.from(new Set(projectAgents)).sort();

    names.forEach((name) => {
      if (!items.find((item) => item.name === name)) {
        items.push({
          name,
          title: name,
          path: "",
          description: null,
          source: "project",
          format: "md",
        });
      }
    });

    return items.sort((a, b) => a.name.localeCompare(b.name));
  }, [projectAgentItems, projectAgents]);

  const sections = useMemo<AgentSection[]>(() => {
    const nextSections: AgentSection[] = [];
    if (scopedProjectItems.length > 0) {
      nextSections.push({ label: "Project", items: scopedProjectItems });
    }
    if (globalItems.length > 0) {
      nextSections.push({
        label: scopedProjectItems.length > 0 ? "Global" : "Agents",
        items: globalItems,
      });
    }
    return nextSections;
  }, [globalItems, scopedProjectItems]);

  const allAgentCount = sections.reduce((total, section) => total + section.items.length, 0);

  const copyToClipboard = (agent: string) => {
    navigator.clipboard.writeText(`/${agent}`);
    setCopiedAgent(agent);
    setTimeout(() => setCopiedAgent(null), 1500);
  };

  if (allAgentCount === 0) return null;

  return (
    <Collapsible defaultOpen={false} className="px-2 mt-2">
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground group">
        <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
        <Bot className="h-3 w-3" />
        <span>Agents</span>
        <span className="ml-auto text-[10px] opacity-60">{allAgentCount}</span>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-1 space-y-2">
        {sections.map((section) => (
          <div key={section.label}>
            {sections.length > 1 && (
              <div className="px-3 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/65">
                {section.label}
              </div>
            )}

            <div className="space-y-0.5">
              {section.items.map((agent) => {
                const isSelected =
                  selectedAgent?.path === agent.path && agent.path !== "";

                return (
                  <div
                    key={`${section.label}-${agent.name}`}
                    className={`flex items-start gap-2 overflow-hidden rounded-md transition-colors ${
                      isSelected ? "bg-muted text-foreground" : "hover:bg-muted/80"
                    }`}
                  >
                    <button
                      onClick={() => agent.path && openAgentPreview(agent)}
                      disabled={!agent.path}
                      className="flex min-w-0 flex-1 items-start gap-2 px-3 py-1.5 text-left text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-70"
                      title={agent.path ? "Open agent file" : "Agent file not found"}
                    >
                      <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                      <div className="min-w-0 overflow-hidden pt-[1px]">
                        <div className="truncate text-[13px] font-medium leading-[1.15rem] text-foreground/90">
                          {agent.name}
                        </div>
                        {agent.description && (
                          <div
                            className="line-clamp-2 max-w-full overflow-hidden break-words pt-0.5 text-[12px] leading-[1.15rem] text-muted-foreground/68"
                            style={{
                              overflowWrap: "anywhere",
                            }}
                          >
                            {agent.description}
                          </div>
                        )}
                      </div>
                    </button>

                    <div className="mr-1 flex w-8 shrink-0 items-center justify-end gap-0.5 py-1">
                      <button
                        onClick={() => copyToClipboard(agent.name)}
                        className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-background hover:text-foreground"
                        title={`Copy /${agent.name}`}
                      >
                        {copiedAgent === agent.name ? (
                          <Check className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
