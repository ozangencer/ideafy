"use client";

import { useState, useMemo } from "react";
import { useKanbanStore } from "@/lib/store";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, Plug, Check } from "lucide-react";

export function McpList() {
  const { mcps, projectMcps } = useKanbanStore();
  const [copiedMcp, setCopiedMcp] = useState<string | null>(null);

  // Merge global + project MCPs, remove duplicates
  const allMcps = useMemo(() =>
    Array.from(new Set([...mcps, ...projectMcps])).sort(),
    [mcps, projectMcps]
  );

  const copyToClipboard = (mcp: string) => {
    navigator.clipboard.writeText(`/${mcp}`);
    setCopiedMcp(mcp);
    setTimeout(() => setCopiedMcp(null), 1500);
  };

  if (allMcps.length === 0) return null;

  return (
    <Collapsible defaultOpen={false} className="px-2 mt-2">
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-muted-foreground uppercase tracking-wider font-medium hover:text-foreground transition-colors group">
        <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
        <Plug className="h-3 w-3" />
        <span>MCPs</span>
        <span className="ml-auto text-[10px] opacity-60">{allMcps.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-0.5">
        {allMcps.map((mcp) => (
          <button
            key={mcp}
            onClick={() => copyToClipboard(mcp)}
            className="w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-2"
            title="Click to copy"
          >
            {copiedMcp === mcp ? (
              <>
                <Check className="h-3 w-3 text-green-500" />
                <span className="text-green-500 text-xs">Copied!</span>
              </>
            ) : (
              <>
                <span className="text-[#0a0a0a]/60 font-mono text-xs">/</span>
                <span className="truncate">{mcp}</span>
              </>
            )}
          </button>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
