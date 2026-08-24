"use client";

import { useState, useMemo } from "react";
import { useKanbanStore } from "@/lib/store";
import { SEARCH_MIN_ITEMS, normalizeSearchQuery } from "@/lib/skills/search";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { HighlightedText, SidebarSearchInput } from "./sidebar-search-input";
import { ChevronRight, Plug, Check, Puzzle } from "lucide-react";

export function McpList() {
  const { mcps, projectMcps } = useKanbanStore();
  const [copiedMcp, setCopiedMcp] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const query = normalizeSearchQuery(searchValue);

  // Merge global + project MCPs, remove duplicates
  const allMcps = useMemo(() =>
    Array.from(new Set([...mcps, ...projectMcps])).sort(),
    [mcps, projectMcps]
  );

  // Name only: /api/mcps reads server names out of the config, and an MCP entry
  // carries no description anywhere to match against.
  const visibleMcps = useMemo(
    () => (query ? allMcps.filter((mcp) => mcp.toLowerCase().includes(query)) : allMcps),
    [allMcps, query]
  );

  const copyToClipboard = (mcp: string) => {
    navigator.clipboard.writeText(`/${mcp}`);
    setCopiedMcp(mcp);
    setTimeout(() => setCopiedMcp(null), 1500);
  };

  if (allMcps.length === 0) return null;

  return (
    <Collapsible
      defaultOpen={false}
      onOpenChange={(open) => {
        if (!open) setSearchValue("");
      }}
      className="px-2 mt-2"
    >
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-muted-foreground uppercase tracking-wider font-medium hover:text-foreground transition-colors group">
        <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
        <Plug className="h-3 w-3" />
        <span>MCPs</span>
        <span className="ml-auto text-[10px] opacity-60">
          {query ? `${visibleMcps.length} / ${allMcps.length}` : allMcps.length}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-0.5">
        {allMcps.length >= SEARCH_MIN_ITEMS && (
          <SidebarSearchInput
            value={searchValue}
            onChange={setSearchValue}
            placeholder="Search MCPs..."
          />
        )}

        {query && visibleMcps.length === 0 && (
          <div className="px-3 py-2 text-[12px] leading-[1.2rem] text-muted-foreground/70">
            No MCPs match &ldquo;{searchValue.trim()}&rdquo;.
          </div>
        )}

        {visibleMcps.map((mcp) => {
          const isPluginMcp = mcp.includes(":");
          return (
            <button
              key={mcp}
              onClick={() => copyToClipboard(mcp)}
              className="w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-2"
              title={isPluginMcp ? `Plugin MCP: ${mcp}` : "Click to copy"}
            >
              {copiedMcp === mcp ? (
                <>
                  <Check className="h-3 w-3 text-green-500" />
                  <span className="text-green-500 text-xs">Copied!</span>
                </>
              ) : (
                <>
                  {isPluginMcp ? (
                    <Puzzle className="h-3 w-3 shrink-0 text-accent-blue/90" />
                  ) : (
                    <span className="text-ink/60 font-mono text-xs">/</span>
                  )}
                  <span className="truncate">
                    <HighlightedText text={mcp} query={query} />
                  </span>
                </>
              )}
            </button>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}
