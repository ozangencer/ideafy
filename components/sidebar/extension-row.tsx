"use client";

import { useState } from "react";
import type { AgentListItem, SkillListItem, ToolkitKind } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HighlightedText } from "./sidebar-search-input";
import {
  Bot,
  Check,
  Copy,
  Folder,
  FolderInput,
  FolderMinus,
  FolderPlus,
  MoreHorizontal,
  Pin,
  PinOff,
  Puzzle,
  Zap,
} from "lucide-react";

/** Below this sidebar width the row actions fold into a "…" menu. */
export const INLINE_ROW_ACTIONS_MIN_WIDTH = 280;

// A skill or an agent as the sidebar shows it. Both catalogs share the fields
// a row needs; `item` keeps the original for the preview panel.
export type ExtensionEntry =
  | { kind: "skill"; item: SkillListItem }
  | { kind: "agent"; item: AgentListItem };

export function skillEntry(item: SkillListItem): ExtensionEntry {
  return { kind: "skill", item };
}

export function agentEntry(item: AgentListItem): ExtensionEntry {
  return { kind: "agent", item };
}

export function ExtensionIcon({
  kind,
  pluginKey,
}: {
  kind: ToolkitKind;
  pluginKey?: string | null;
}) {
  if (pluginKey) {
    return <Puzzle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-blue/90" />;
  }
  const Icon = kind === "skill" ? Zap : Bot;
  return <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />;
}

// Toolkit rows only: where the pin sits and how to move it.
export type FolderMenuProps = {
  current: string | null;
  folders: string[];
  onMove: (folder: string | null) => void;
  onNewFolder: () => void;
};

function FolderMenuItems({ current, folders, onMove, onNewFolder }: FolderMenuProps) {
  return (
    <>
      {folders.map((folder) => (
        <DropdownMenuItem
          key={folder}
          disabled={folder === current}
          onClick={() => onMove(folder)}
        >
          {folder === current ? <Check className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
          <span className="truncate">{folder}</span>
        </DropdownMenuItem>
      ))}
      {folders.length > 0 && <DropdownMenuSeparator />}
      <DropdownMenuItem onClick={onNewFolder}>
        <FolderPlus className="h-3.5 w-3.5" />
        New folder…
      </DropdownMenuItem>
      {current && (
        <DropdownMenuItem onClick={() => onMove(null)}>
          <FolderMinus className="h-3.5 w-3.5" />
          Remove from folder
        </DropdownMenuItem>
      )}
    </>
  );
}

type ExtensionRowProps = {
  entry: ExtensionEntry;
  query?: string;
  isSelected: boolean;
  canInlineActions: boolean;
  onOpen: () => void;
  // Undefined hides the pin action (no active project to pin to).
  pinned?: boolean;
  onTogglePin?: () => void;
  folderMenu?: FolderMenuProps;
};

export function ExtensionRow({
  entry,
  query = "",
  isSelected,
  canInlineActions,
  onOpen,
  pinned,
  onTogglePin,
  folderMenu,
}: ExtensionRowProps) {
  const { item, kind } = entry;
  const canOpen = !!item.path;

  return (
    <div
      className={`group flex items-start gap-2 overflow-hidden rounded-md transition-colors ${
        isSelected ? "bg-muted text-foreground" : "hover:bg-muted/80"
      }`}
    >
      <button
        onClick={() => canOpen && onOpen()}
        disabled={!canOpen}
        className="flex min-w-0 flex-1 items-start gap-2 px-3 py-1.5 text-left text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-70"
        title={
          item.pluginKey
            ? `From plugin: ${item.pluginKey}`
            : canOpen
              ? kind === "skill" ? "Open SKILL.md" : "Open agent file"
              : "File not found"
        }
      >
        <ExtensionIcon kind={kind} pluginKey={item.pluginKey} />
        <div className="min-w-0 overflow-hidden pt-[1px]">
          <div className="truncate text-[13px] font-medium leading-[1.15rem] text-foreground/90 group-hover:text-foreground">
            <HighlightedText text={item.name} query={query} />
          </div>
          {item.description && (
            <div
              className="line-clamp-2 max-w-full overflow-hidden break-words pt-0.5 text-[12px] leading-[1.15rem] text-muted-foreground/70 transition-colors group-hover:text-muted-foreground"
              style={{ overflowWrap: "anywhere" }}
            >
              <HighlightedText text={item.description} query={query} />
            </div>
          )}
        </div>
      </button>

      <RowActions
        name={item.name}
        canInlineActions={canInlineActions}
        pinned={pinned}
        onTogglePin={onTogglePin}
        folderMenu={folderMenu}
      />
    </div>
  );
}

type RowActionsProps = {
  name: string;
  canInlineActions: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
  folderMenu?: FolderMenuProps;
};

export function RowActions({
  name,
  canInlineActions,
  pinned,
  onTogglePin,
  folderMenu,
}: RowActionsProps) {
  const [copied, setCopied] = useState(false);
  const showPin = pinned !== undefined && !!onTogglePin;

  const copy = () => {
    navigator.clipboard.writeText(`/${name}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const CopyIcon = copied ? Check : Copy;
  const PinIcon = pinned ? PinOff : Pin;
  const pinLabel = pinned ? "Unpin from Toolkit" : "Pin to Toolkit";

  if (canInlineActions) {
    return (
      <div className="mr-1 flex shrink-0 items-start justify-end gap-0.5 py-1">
        {folderMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-background hover:text-foreground"
                title="Move to folder"
                aria-label="Move to folder"
              >
                <FolderInput className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <FolderMenuItems {...folderMenu} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {showPin && (
          <button
            onClick={onTogglePin}
            className={`flex h-[26px] w-[26px] items-center justify-center rounded-md transition-colors hover:bg-background hover:text-foreground ${
              pinned ? "text-foreground/80" : "text-muted-foreground/80"
            }`}
            title={pinLabel}
            aria-label={pinLabel}
          >
            <PinIcon className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={copy}
          className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-background hover:text-foreground"
          title={`Copy /${name}`}
          aria-label={`Copy /${name}`}
        >
          <CopyIcon className={`h-3.5 w-3.5 ${copied ? "text-green-500" : ""}`} />
        </button>
      </div>
    );
  }

  return (
    <div className="mr-1 w-8 shrink-0 py-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            title="Actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {folderMenu && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="h-3.5 w-3.5" />
                Move to folder
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                <FolderMenuItems {...folderMenu} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {showPin && (
            <DropdownMenuItem onClick={onTogglePin}>
              <PinIcon className="h-3.5 w-3.5" />
              {pinLabel}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={copy}>
            <CopyIcon className={`h-3.5 w-3.5 ${copied ? "text-green-500" : ""}`} />
            Copy /{name}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
