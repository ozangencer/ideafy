"use client";

import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useKanbanStore } from "@/lib/store";
import type { AgentListItem, SkillListItem, SkillSource, ToolkitKind } from "@/lib/types";
import { isPinned } from "@/lib/toolkit-keys";
import {
  SEARCH_MIN_ITEMS,
  matchesSearchQuery,
  normalizeSearchQuery,
} from "@/lib/skills/search";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { SidebarSearchInput } from "./sidebar-search-input";
import {
  ExtensionRow,
  INLINE_ROW_ACTIONS_MIN_WIDTH,
  agentEntry,
  skillEntry,
  type ExtensionEntry,
} from "./extension-row";
import { ChevronRight, Library } from "lucide-react";
import { SIDEBAR_SECTION_COUNT, SIDEBAR_SECTION_LABEL } from "./sidebar-section-label";

type KindFilter = "all" | ToolkitKind;

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "skill", label: "Skills" },
  { value: "agent", label: "Agents" },
];

type LibrarySection = { label: string; entries: ExtensionEntry[] };

// Catalog rows plus any name the list endpoint returned without a row, so a
// skill whose file could not be parsed still shows up (unclickable).
function withFallbackNames<T extends { name: string }>(
  items: T[],
  names: string[],
  fallback: (name: string) => T
): T[] {
  const byName = new Map<string, T>();
  items.forEach((item) => {
    if (!byName.has(item.name)) byName.set(item.name, item);
  });
  names.forEach((name) => {
    if (!byName.has(name)) byName.set(name, fallback(name));
  });
  return Array.from(byName.values());
}

function fallbackSkill(source: SkillSource) {
  return (name: string): SkillListItem => ({
    name,
    title: name,
    path: "",
    description: null,
    source,
  });
}

function fallbackAgent(source: SkillSource) {
  return (name: string): AgentListItem => ({
    name,
    title: name,
    path: "",
    description: null,
    source,
    format: "md",
  });
}

function sortEntries(entries: ExtensionEntry[]): ExtensionEntry[] {
  return entries.sort((a, b) => a.item.name.localeCompare(b.item.name));
}

/**
 * Every skill and agent the active provider lists, behind one search box and
 * a kind filter. Plugin-provided entries are hidden unless the "Show plugin
 * items" switch is on — they are most of the catalog and rarely what a
 * project needs at hand.
 */
export function LibraryList() {
  const {
    skills,
    projectSkills,
    skillItems,
    projectSkillItems,
    agents,
    projectAgents,
    agentItems,
    projectAgentItems,
    selectedSkill,
    selectedAgent,
    openSkillPreview,
    openAgentPreview,
    activeProjectId,
    toolkitItems,
    pinToolkitItem,
    unpinToolkitItem,
    sidebarWidth,
    settings,
    updateSettings,
  } = useKanbanStore(
    useShallow((s) => ({
      skills: s.skills,
      projectSkills: s.projectSkills,
      skillItems: s.skillItems,
      projectSkillItems: s.projectSkillItems,
      agents: s.agents,
      projectAgents: s.projectAgents,
      agentItems: s.agentItems,
      projectAgentItems: s.projectAgentItems,
      selectedSkill: s.selectedSkill,
      selectedAgent: s.selectedAgent,
      openSkillPreview: s.openSkillPreview,
      openAgentPreview: s.openAgentPreview,
      activeProjectId: s.activeProjectId,
      toolkitItems: s.toolkitItems,
      pinToolkitItem: s.pinToolkitItem,
      unpinToolkitItem: s.unpinToolkitItem,
      sidebarWidth: s.sidebarWidth,
      settings: s.settings,
      updateSettings: s.updateSettings,
    }))
  );
  const [searchValue, setSearchValue] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const query = normalizeSearchQuery(searchValue);
  const canInlineActions = sidebarWidth >= INLINE_ROW_ACTIONS_MIN_WIDTH;
  const showPluginItems = settings?.showPluginItems ?? false;

  const sections = useMemo<LibrarySection[]>(() => {
    const project = sortEntries([
      ...withFallbackNames(projectSkillItems, projectSkills, fallbackSkill("project")).map(skillEntry),
      ...withFallbackNames(projectAgentItems, projectAgents, fallbackAgent("project")).map(agentEntry),
    ]);
    const global = sortEntries([
      ...withFallbackNames(skillItems, skills, fallbackSkill("global")).map(skillEntry),
      ...withFallbackNames(agentItems, agents, fallbackAgent("global")).map(agentEntry),
    ]);
    return [
      { label: "Project", entries: project },
      { label: "Global", entries: global },
    ];
  }, [agentItems, agents, projectAgentItems, projectAgents, projectSkillItems, projectSkills, skillItems, skills]);

  const byKind = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        entries: section.entries.filter(
          (entry) => kindFilter === "all" || entry.kind === kindFilter
        ),
      })),
    [kindFilter, sections]
  );

  const hiddenPluginCount = showPluginItems
    ? 0
    : byKind.reduce(
        (total, section) =>
          total + section.entries.filter((entry) => entry.item.pluginKey).length,
        0
      );
  const hasPluginItems = sections.some((section) =>
    section.entries.some((entry) => entry.item.pluginKey)
  );

  const visible = useMemo(
    () =>
      byKind.map((section) => ({
        ...section,
        entries: showPluginItems
          ? section.entries
          : section.entries.filter((entry) => !entry.item.pluginKey),
      })),
    [byKind, showPluginItems]
  );

  const filtered = useMemo(
    () =>
      visible
        .map((section) => ({
          ...section,
          entries: section.entries.filter((entry) => matchesSearchQuery(entry.item, query)),
        }))
        .filter((section) => section.entries.length > 0),
    [query, visible]
  );

  const catalogCount = sections.reduce((total, section) => total + section.entries.length, 0);
  const totalCount = visible.reduce((total, section) => total + section.entries.length, 0);
  const matchedCount = filtered.reduce((total, section) => total + section.entries.length, 0);

  if (catalogCount === 0) return null;

  return (
    <Collapsible
      defaultOpen={false}
      onOpenChange={(open) => {
        // A stale filter waiting behind a closed section reads as a bug when
        // the section is reopened.
        if (!open) setSearchValue("");
      }}
      className={`px-2 ${activeProjectId ? "mt-2" : "mt-4"}`}
    >
      <CollapsibleTrigger className={`flex items-center gap-2 w-full px-3 py-1.5 ${SIDEBAR_SECTION_LABEL} transition-colors hover:text-foreground group`}>
        <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
        <Library className="h-3 w-3" />
        <span>Library</span>
        <span className={SIDEBAR_SECTION_COUNT}>
          {query ? `${matchedCount} / ${totalCount}` : totalCount}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-1 space-y-2">
        <div className="px-3" role="radiogroup" aria-label="Library filter">
          <div className="grid grid-cols-3 gap-0.5 rounded-md border border-border bg-ink/[0.03] p-0.5">
            {KIND_FILTERS.map((filter) => {
              const isActive = kindFilter === filter.value;
              return (
                <button
                  key={filter.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => setKindFilter(filter.value)}
                  className={`truncate rounded px-1.5 py-1 text-[11px] transition-colors ${
                    isActive
                      ? "bg-ink/10 font-semibold text-foreground"
                      : "font-medium text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>

        {catalogCount >= SEARCH_MIN_ITEMS && (
          <SidebarSearchInput
            value={searchValue}
            onChange={setSearchValue}
            placeholder="Search skills and agents..."
          />
        )}

        {hasPluginItems && (
          <label className="flex cursor-pointer items-center justify-between gap-2 px-3 text-[12px] text-muted-foreground">
            <span className="min-w-0 truncate">
              {showPluginItems
                ? "Show plugin items"
                : `${hiddenPluginCount} plugin item${hiddenPluginCount === 1 ? "" : "s"} hidden`}
            </span>
            <Switch
              checked={showPluginItems}
              onCheckedChange={(checked) => void updateSettings({ showPluginItems: checked })}
              aria-label="Show plugin items"
              className="scale-75"
            />
          </label>
        )}

        {matchedCount === 0 && (
          <div className="px-3 py-2 text-[12px] leading-[1.2rem] text-muted-foreground/70">
            {query
              ? <>Nothing matches &ldquo;{searchValue.trim()}&rdquo;.</>
              : "Nothing to show with these filters."}
          </div>
        )}

        {filtered.map((section) => (
          <div key={section.label}>
            {filtered.length > 1 && (
              <div className="px-3 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/65">
                {section.label}
              </div>
            )}

            <div className="space-y-0.5">
              {section.entries.map((entry) => {
                const { item, kind } = entry;
                const isSelected =
                  item.path !== "" &&
                  (kind === "skill"
                    ? selectedSkill?.path === item.path
                    : selectedAgent?.path === item.path);
                const pinned = activeProjectId
                  ? isPinned(toolkitItems, kind, item.name)
                  : undefined;

                return (
                  <ExtensionRow
                    key={`${section.label}-${kind}-${item.name}`}
                    entry={entry}
                    query={query}
                    isSelected={isSelected}
                    canInlineActions={canInlineActions}
                    onOpen={() =>
                      entry.kind === "skill"
                        ? void openSkillPreview(entry.item)
                        : void openAgentPreview(entry.item)
                    }
                    pinned={pinned}
                    onTogglePin={
                      activeProjectId
                        ? () =>
                            pinned
                              ? void unpinToolkitItem(kind, item.name)
                              : void pinToolkitItem(kind, item.name, item.source)
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
