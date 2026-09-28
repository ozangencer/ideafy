"use client";

import { useMemo, useState } from "react";
import { useKanbanStore } from "@/lib/store";
import { AI_PLATFORM_OPTIONS, type ToolkitItem, type ToolkitKind } from "@/lib/types";
import { groupToolkitByFolder, toolkitFolderNames } from "@/lib/toolkit-keys";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ExtensionIcon,
  ExtensionRow,
  INLINE_ROW_ACTIONS_MIN_WIDTH,
  RowActions,
  agentEntry,
  skillEntry,
  type ExtensionEntry,
  type FolderMenuProps,
} from "./extension-row";
import { NameDialog } from "./name-dialog";
import { ChevronRight, Folder, FolderMinus, Pencil, Pin } from "lucide-react";

type ResolvedPin = { pin: ToolkitItem; entry: ExtensionEntry | null };

/**
 * The active project's pinned skills and agents. A pin is stored by name, so
 * it is resolved against whatever the current provider lists: a project item
 * wins over a global one of the same name, and a name the provider does not
 * know stays in the list, greyed out, until it is unpinned or the provider
 * changes back.
 */
export function ToolkitList() {
  const {
    toolkitItems,
    skillItems,
    projectSkillItems,
    agentItems,
    projectAgentItems,
    selectedSkill,
    selectedAgent,
    openSkillPreview,
    openAgentPreview,
    unpinToolkitItem,
    moveToolkitItem,
    renameToolkitFolder,
    sidebarWidth,
    settings,
  } = useKanbanStore();
  // "new" carries the pin that moves into the folder once it is named.
  const [folderDialog, setFolderDialog] = useState<
    | { mode: "new"; kind: ToolkitKind; name: string }
    | { mode: "rename"; folder: string }
    | null
  >(null);
  const canInlineActions = sidebarWidth >= INLINE_ROW_ACTIONS_MIN_WIDTH;
  const platformLabel =
    AI_PLATFORM_OPTIONS.find((option) => option.value === settings?.aiPlatform)?.label ??
    "this AI platform";

  const resolved = useMemo<ResolvedPin[]>(
    () =>
      toolkitItems.map((pin) => {
        if (pin.kind === "skill") {
          const item =
            projectSkillItems.find((skill) => skill.name === pin.name) ??
            skillItems.find((skill) => skill.name === pin.name);
          return { pin, entry: item ? skillEntry(item) : null };
        }
        const item =
          projectAgentItems.find((agent) => agent.name === pin.name) ??
          agentItems.find((agent) => agent.name === pin.name);
        return { pin, entry: item ? agentEntry(item) : null };
      }),
    [agentItems, projectAgentItems, projectSkillItems, skillItems, toolkitItems]
  );

  const byKey = useMemo(
    () => new Map(resolved.map((row) => [row.pin.id, row])),
    [resolved]
  );
  const groups = useMemo(() => groupToolkitByFolder(toolkitItems), [toolkitItems]);
  const folderNames = useMemo(() => toolkitFolderNames(toolkitItems), [toolkitItems]);

  const folderMenuFor = (pin: ToolkitItem): FolderMenuProps => ({
    current: pin.folder,
    folders: folderNames,
    onMove: (folder) => void moveToolkitItem(pin.kind, pin.name, folder),
    // Deferred so the dropdown finishes closing before the dialog takes focus.
    onNewFolder: () =>
      setTimeout(() => setFolderDialog({ mode: "new", kind: pin.kind, name: pin.name }), 0),
  });

  const renderPin = ({ pin, entry }: ResolvedPin) => {
    const unpin = () => void unpinToolkitItem(pin.kind, pin.name);
    const folderMenu = folderMenuFor(pin);

    if (!entry) {
      return (
        <div
          key={pin.id}
          className="flex items-start gap-2 overflow-hidden rounded-md opacity-60"
        >
          <div className="flex min-w-0 flex-1 items-start gap-2 px-3 py-1.5 text-muted-foreground">
            <ExtensionIcon kind={pin.kind} />
            <div className="min-w-0 overflow-hidden pt-[1px]">
              <div className="truncate text-[13px] font-medium leading-[1.15rem] text-foreground/90">
                {pin.name}
              </div>
              <div className="pt-0.5 text-[12px] leading-[1.15rem] text-muted-foreground">
                Not available for {platformLabel}
              </div>
            </div>
          </div>
          <RowActions
            name={pin.name}
            canInlineActions={canInlineActions}
            pinned
            onTogglePin={unpin}
            folderMenu={folderMenu}
          />
        </div>
      );
    }

    const isSelected =
      entry.item.path !== "" &&
      (entry.kind === "skill"
        ? selectedSkill?.path === entry.item.path
        : selectedAgent?.path === entry.item.path);

    return (
      <ExtensionRow
        key={pin.id}
        entry={entry}
        isSelected={isSelected}
        canInlineActions={canInlineActions}
        onOpen={() =>
          entry.kind === "skill"
            ? void openSkillPreview(entry.item)
            : void openAgentPreview(entry.item)
        }
        pinned
        onTogglePin={unpin}
        folderMenu={folderMenu}
      />
    );
  };

  return (
    <Collapsible defaultOpen className="px-2 mt-4">
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground group">
        <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
        <Pin className="h-3 w-3" />
        <span>Toolkit</span>
        <span className="ml-auto text-[10px] opacity-60">{toolkitItems.length}</span>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-1 space-y-0.5">
        {resolved.length === 0 && (
          <div className="px-3 py-2 text-[12px] leading-[1.2rem] text-muted-foreground/70">
            Pin skills and agents from the Library to keep this project&rsquo;s tools here.
          </div>
        )}

        {groups.map((group) => {
          const rows = group.items.map((pin) => byKey.get(pin.id)).filter(Boolean) as ResolvedPin[];
          if (!group.folder) return rows.map(renderPin);

          const folder = group.folder;
          return (
            <Collapsible key={`folder-${folder}`} defaultOpen>
              <div className="group/folder flex items-center rounded-md hover:bg-muted/80">
                <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-[13px] font-medium text-foreground/85 transition-colors hover:text-foreground">
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                  <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                  <span className="truncate">{folder}</span>
                  <span className="text-[10px] text-muted-foreground/60">{rows.length}</span>
                </CollapsibleTrigger>
                <div className="mr-1 flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/folder:opacity-100">
                  <button
                    onClick={() => setFolderDialog({ mode: "rename", folder })}
                    className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-background hover:text-foreground"
                    title="Rename folder"
                    aria-label={`Rename folder ${folder}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => void renameToolkitFolder(folder, null)}
                    className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-background hover:text-foreground"
                    title="Remove folder (items stay pinned)"
                    aria-label={`Remove folder ${folder}`}
                  >
                    <FolderMinus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <CollapsibleContent className="ml-3 space-y-0.5 border-l border-border/60 pl-1">
                {rows.map(renderPin)}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </CollapsibleContent>

      <NameDialog
        open={folderDialog !== null}
        onOpenChange={(open) => {
          if (!open) setFolderDialog(null);
        }}
        title={folderDialog?.mode === "rename" ? "Rename Folder" : "New Folder"}
        description={
          folderDialog?.mode === "new"
            ? `Group Toolkit items, e.g. Documentation. ${folderDialog.name} moves into it.`
            : "Update the folder name shown in the Toolkit and the / picker."
        }
        submitLabel={folderDialog?.mode === "rename" ? "Rename" : "Create"}
        initialValue={folderDialog?.mode === "rename" ? folderDialog.folder : ""}
        existingNames={folderNames}
        placeholder="Folder name"
        conflictMessage="A folder with this name already exists."
        onSubmit={(name) => {
          if (folderDialog?.mode === "new") {
            void moveToolkitItem(folderDialog.kind, folderDialog.name, name);
          } else if (folderDialog?.mode === "rename") {
            void renameToolkitFolder(folderDialog.folder, name);
          }
        }}
      />
    </Collapsible>
  );
}
