"use client";

import { useState, useMemo } from "react";
import { useKanbanStore } from "@/lib/store";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, Bot, Check } from "lucide-react";

export function AgentList() {
  const { agents, projectAgents } = useKanbanStore();
  const [copiedAgent, setCopiedAgent] = useState<string | null>(null);

  const allAgents = useMemo(() =>
    Array.from(new Set([...agents, ...projectAgents])).sort(),
    [agents, projectAgents]
  );

  const copyToClipboard = (agent: string) => {
    navigator.clipboard.writeText(`/${agent}`);
    setCopiedAgent(agent);
    setTimeout(() => setCopiedAgent(null), 1500);
  };

  if (allAgents.length === 0) return null;

  return (
    <Collapsible defaultOpen={false} className="px-2 mt-2">
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-muted-foreground uppercase tracking-wider font-medium hover:text-foreground transition-colors group">
        <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
        <Bot className="h-3 w-3" />
        <span>Agents</span>
        <span className="ml-auto text-[10px] opacity-60">{allAgents.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-0.5">
        {allAgents.map((agent) => (
          <button
            key={agent}
            onClick={() => copyToClipboard(agent)}
            className="w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-2"
            title="Click to copy"
          >
            {copiedAgent === agent ? (
              <>
                <Check className="h-3 w-3 text-green-500" />
                <span className="text-green-500 text-xs">Copied!</span>
              </>
            ) : (
              <>
                <span className="text-amber-500/70 font-mono text-xs">/</span>
                <span className="truncate">{agent}</span>
              </>
            )}
          </button>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
