"use client";

import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PRESET_COLORS } from "@/components/sidebar/project-form/constants";
import { CardGroupChip } from "@/components/board/card-group-chip";
import { useKanbanStore } from "@/lib/store";
import type { CardGroup } from "@/lib/types";

/**
 * Membership in a chain, set from the card itself.
 *
 * Until this existed, `cards.group_id` could only be written over MCP or by the
 * backfill script — the board could show a chain but nothing in the UI could
 * put a card into one, or take it out. The picker sits next to the display-id
 * chip because that is where the same code already shows on the card face: the
 * two read as one identity strip, and membership is identity, not metadata.
 * Hence not a sixth select in the metadata row.
 */

const CODE_MAX = 6;

/** The code is an identity on the card face, so it is normalised, not trusted:
 *  uppercase, no spaces, and only the characters the chip renders cleanly. */
const normalizeCode = (raw: string): string =>
  raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_MAX);

interface CardGroupPickerProps {
  value: string | null;
  onChange: (groupId: string | null) => void;
  /** Scopes the list, and stamps a newly created group. */
  projectId: string | null;
  disabled?: boolean;
}

export function CardGroupPicker({
  value,
  onChange,
  projectId,
  disabled,
}: CardGroupPickerProps) {
  const cardGroups = useKanbanStore((s) => s.cardGroups);
  const createCardGroup = useKanbanStore((s) => s.createCardGroup);

  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(PRESET_COLORS[0]);
  const [isSaving, setIsSaving] = useState(false);

  const selected = cardGroups.find((g) => g.id === value) ?? null;

  // Project-less groups are shared (that is what the backfill writes when a
  // chain spans projects), so they stay visible everywhere. A group from
  // another project only shows if this card is already in it — hiding the
  // card's own group would make the picker lie about where it is.
  const groups = useMemo<CardGroup[]>(() => {
    const visible = cardGroups.filter(
      (g) => !g.projectId || !projectId || g.projectId === projectId
    );
    if (selected && !visible.some((g) => g.id === selected.id)) {
      return [selected, ...visible];
    }
    return visible;
  }, [cardGroups, projectId, selected]);

  const codeTaken = groups.some(
    (g) => g.code.toUpperCase() === newCode && newCode.length > 0
  );
  const canCreate = newCode.length > 0 && !codeTaken && !isSaving;

  const resetCreateForm = () => {
    setIsCreating(false);
    setNewCode("");
    setNewName("");
    setNewColor(PRESET_COLORS[0]);
  };

  const closeAll = () => {
    setOpen(false);
    resetCreateForm();
  };

  const handlePick = (groupId: string | null) => {
    onChange(groupId);
    closeAll();
  };

  const handleCreate = async () => {
    if (!canCreate) return;
    setIsSaving(true);
    const group = await createCardGroup({
      code: newCode,
      name: newName.trim() || newCode,
      color: newColor,
      projectId,
    });
    setIsSaving(false);
    if (!group) return;
    onChange(group.id);
    closeAll();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetCreateForm();
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          className={`inline-flex items-center gap-1.5 max-w-[240px] rounded px-1.5 py-0.5 transition-colors ${
            disabled ? "cursor-default" : "hover:bg-ink/[0.06]"
          }`}
          title={selected ? selected.name : "Add to a chain"}
        >
          {selected ? (
            <>
              <CardGroupChip group={selected} />
              <span className="text-xs text-muted-foreground truncate">
                {selected.name}
              </span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-mono tracking-wide text-muted-foreground/70 border border-dashed border-ink/25 rounded px-1 py-0.5">
              <Plus className="h-2.5 w-2.5" />
              GROUP
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-2">
        {isCreating ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
                New Group
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground"
                onClick={resetCreateForm}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="flex gap-2">
              <Input
                value={newCode}
                onChange={(e) => setNewCode(normalizeCode(e.target.value))}
                placeholder="LOOP"
                autoFocus
                className="h-8 w-20 text-xs font-mono uppercase"
              />
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Loop Engineering"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
                className="h-8 flex-1 text-xs"
              />
            </div>

            {/* The code is what the card face shows, so two chains sharing one
                would be indistinguishable on the board. */}
            {codeTaken && (
              <p className="px-1 text-xs text-destructive">
                {newCode} is already taken
              </p>
            )}

            <div className="flex items-center gap-1.5 px-1">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setNewColor(color)}
                  className={`h-4 w-4 rounded-full transition-transform ${
                    newColor === color
                      ? "ring-2 ring-ink ring-offset-2 ring-offset-popover"
                      : "hover:scale-110"
                  }`}
                  style={{ backgroundColor: color }}
                  aria-label={color}
                />
              ))}
            </div>

            <Button
              size="sm"
              className="w-full"
              disabled={!canCreate}
              onClick={handleCreate}
            >
              Create &amp; assign
            </Button>
          </div>
        ) : (
          <>
            <div className="px-2 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
              Group
            </div>

            <div className="mt-1 max-h-60 space-y-1 overflow-y-auto">
              {groups.map((group) => {
                const isActive = value === group.id;
                return (
                  <button
                    key={group.id}
                    onClick={() => handlePick(group.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <CardGroupChip group={group} />
                    <span className="flex-1 truncate">{group.name}</span>
                    {isActive && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })}

              <button
                onClick={() => handlePick(null)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  value === null
                    ? "bg-accent text-accent-foreground"
                    : "text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <span className="flex-1">No group</span>
                {value === null && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            </div>

            <div className="mt-2 border-t border-border pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => setIsCreating(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                New group
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
