"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PRESET_COLORS } from "@/components/sidebar/project-form/constants";
import { CardGroupChip } from "@/components/board/card-group-chip";
import { summarizeCardGroups } from "@/lib/card-group";
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
 *
 * It is also the only surface a chain has, so its whole life happens here:
 * minted, renamed, and — once nobody is in it — dropped. The board needs no
 * such surface, because a chain that has stopped moving already leaves it
 * (`isComplete`); this list is the one place a dead chain would otherwise
 * accumulate forever.
 */

const CODE_MAX = 6;

/** The code is an identity on the card face, so it is normalised, not trusted:
 *  uppercase, no spaces, and only the characters the chip renders cleanly. */
const normalizeCode = (raw: string): string =>
  raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_MAX);

/**
 * Why a group is or is not still a choice — derived, never stored. A chain has
 * no status of its own; these are just readings of where its cards are.
 *
 * `empty` and `finished` are kept apart because they answer different
 * questions. Empty is a chain nobody is in: a typo, or one drained card by
 * card, and the only one it is safe to delete. Finished is a chain whose cards
 * are all done or withdrawn: still true history, so it is put away rather than
 * offered up for deletion.
 */
type GroupState =
  | { kind: "live" }
  | { kind: "finished"; done: number; total: number }
  | { kind: "empty" };

/** The two states that drop a chain below the fold. */
type InactiveState = Exclude<GroupState, { kind: "live" }>;

interface CardGroupPickerProps {
  value: string | null;
  onChange: (groupId: string | null) => void;
  /** Scopes the list, and stamps a newly created group. */
  projectId: string | null;
  disabled?: boolean;
}

type FormState =
  | { mode: "create" }
  | { mode: "edit"; group: CardGroup }
  | null;

export function CardGroupPicker({
  value,
  onChange,
  projectId,
  disabled,
}: CardGroupPickerProps) {
  const cards = useKanbanStore((s) => s.cards);
  const cardGroups = useKanbanStore((s) => s.cardGroups);
  const createCardGroup = useKanbanStore((s) => s.createCardGroup);
  const updateCardGroup = useKanbanStore((s) => s.updateCardGroup);
  const deleteCardGroup = useKanbanStore((s) => s.deleteCardGroup);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(null);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  // Nullable, because a group can genuinely have no colour — the backfill
  // wrote plenty. Defaulting the swatch on the way in would repaint a chain's
  // chip on the board as a side effect of fixing a typo in its name.
  const [newColor, setNewColor] = useState<string | null>(PRESET_COLORS[0]);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const selected = cardGroups.find((g) => g.id === value) ?? null;
  const editing = form?.mode === "edit" ? form.group : null;

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

  const summaries = useMemo(
    () => summarizeCardGroups(cards, cardGroups),
    [cards, cardGroups]
  );

  const stateOf = (group: CardGroup): GroupState => {
    const summary = summaries.get(group.id);
    // No summary means no members at all — `summarizeCardGroups` skips those,
    // since a chain with nobody in it has nothing to roll up.
    if (!summary) return { kind: "empty" };
    if (summary.isComplete)
      return { kind: "finished", done: summary.done, total: summary.total };
    return { kind: "live" };
  };

  // The card's own group always stays above the fold, whatever state it is in.
  // Tucking it away would repeat the lie the visibility filter above avoids.
  const { live, inactive } = useMemo(() => {
    const liveGroups: CardGroup[] = [];
    const inactiveGroups: Array<{ group: CardGroup; state: InactiveState }> = [];
    for (const group of groups) {
      if (group.id === value) {
        liveGroups.push(group);
        continue;
      }
      const state = stateOf(group);
      if (state.kind === "live") {
        liveGroups.push(group);
        continue;
      }
      inactiveGroups.push({ group, state });
    }
    return { live: liveGroups, inactive: inactiveGroups };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, summaries, value]);

  // Editing a group must not report its own code as taken. Note this only
  // looks at the visible list, same as it always has — two projects can still
  // mint the same code, which is a separate problem from this one.
  const codeTaken = groups.some(
    (g) =>
      g.id !== editing?.id &&
      g.code.toUpperCase() === newCode &&
      newCode.length > 0
  );
  const canSave = newCode.length > 0 && !codeTaken && !isSaving;

  const editingState = editing ? stateOf(editing) : null;
  // Deletion releases members rather than taking them along, so it is offered
  // only where there is nobody to release. The card in hand counts as a
  // member even before it is saved — a draft is not in `cards` yet, so its
  // chain would otherwise read as empty.
  const canDelete =
    editing !== null && editingState?.kind === "empty" && editing.id !== value;

  const closeForm = () => {
    setForm(null);
    setNewCode("");
    setNewName("");
    setNewColor(PRESET_COLORS[0]);
    setConfirmingDelete(false);
  };

  const closeAll = () => {
    setOpen(false);
    closeForm();
  };

  const startCreating = () => {
    setNewCode("");
    setNewName("");
    setNewColor(PRESET_COLORS[0]);
    setConfirmingDelete(false);
    setForm({ mode: "create" });
  };

  const startEditing = (group: CardGroup) => {
    setNewCode(normalizeCode(group.code));
    setNewName(group.name);
    setNewColor(group.color);
    setConfirmingDelete(false);
    setForm({ mode: "edit", group });
  };

  const handlePick = (groupId: string | null) => {
    onChange(groupId);
    closeAll();
  };

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);

    if (editing) {
      await updateCardGroup(editing.id, {
        code: newCode,
        name: newName.trim() || newCode,
        color: newColor,
      });
      setIsSaving(false);
      // Renaming is not picking: the list comes back so the next chain can be
      // tidied in the same pass.
      closeForm();
      return;
    }

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

  const handleDelete = async () => {
    if (!editing || !canDelete) return;
    setIsSaving(true);
    await deleteCardGroup(editing.id);
    setIsSaving(false);
    closeForm();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) closeForm();
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
        {form ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
                {editing ? "Edit Group" : "New Group"}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground"
                onClick={closeForm}
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
                  if (e.key === "Enter") handleSave();
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
              disabled={!canSave}
              onClick={handleSave}
            >
              {editing ? "Save" : "Create & assign"}
            </Button>

            {editing && (
              <div className="border-t border-border pt-2">
                {canDelete ? (
                  confirmingDelete ? (
                    <div className="flex items-center gap-1.5">
                      <span className="flex-1 px-1 text-xs text-muted-foreground">
                        Delete {editing.code}?
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setConfirmingDelete(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={isSaving}
                        onClick={handleDelete}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-destructive hover:text-destructive"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      Delete group
                    </Button>
                  )
                ) : (
                  // The rule, not a disabled button: a chain with members
                  // cannot be deleted, because deleting it would quietly drop
                  // every one of them out of the chain.
                  <p className="px-1 text-xs text-muted-foreground">
                    {editingState?.kind === "empty"
                      ? "This card is in it — pick “No group” first."
                      : `${
                          summaries.get(editing.id)?.total ?? 0
                        } cards are in this chain. Remove them to delete it.`}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="px-2 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
              Group
            </div>

            <div className="mt-1 max-h-60 space-y-1 overflow-y-auto">
              {live.map((group) => (
                <GroupRow
                  key={group.id}
                  group={group}
                  isActive={value === group.id}
                  onPick={() => handlePick(group.id)}
                  onEdit={() => startEditing(group)}
                />
              ))}

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

              {/* Chains that have stopped moving are still pickable — a
                  follow-up joins a finished chain often enough — but they no
                  longer share the list with the ones you are choosing between,
                  which is what made this list grow without end. */}
              {inactive.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowInactive((prev) => !prev)}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronDown
                      className={`h-3 w-3 shrink-0 transition-transform ${
                        showInactive ? "" : "-rotate-90"
                      }`}
                    />
                    {inactive.length} inactive
                  </button>

                  {showInactive &&
                    inactive.map(({ group, state }) => (
                      <GroupRow
                        key={group.id}
                        group={group}
                        isActive={false}
                        hint={
                          state.kind === "empty"
                            ? "empty"
                            : `${state.done}/${state.total} done`
                        }
                        onPick={() => handlePick(group.id)}
                        onEdit={() => startEditing(group)}
                      />
                    ))}
                </>
              )}
            </div>

            <div className="mt-2 border-t border-border pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={startCreating}
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

/**
 * One listed chain: pick it, or open it for editing. Two controls, so the row
 * is a container rather than a button — nesting the pencil inside the pick
 * button would make picking the only thing either of them could do.
 */
function GroupRow({
  group,
  isActive,
  hint,
  onPick,
  onEdit,
}: {
  group: CardGroup;
  isActive: boolean;
  hint?: string;
  onPick: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      className={`group/row flex items-center rounded-md pr-1 transition-colors ${
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-popover-foreground hover:bg-accent hover:text-accent-foreground"
      }`}
    >
      <button
        onClick={onPick}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
      >
        <CardGroupChip group={group} />
        <span className="flex-1 truncate">{group.name}</span>
        {/* text-current, not muted: on the accent row a muted hint drops out
            of contrast in both themes. */}
        {hint && (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-current opacity-60">
            {hint}
          </span>
        )}
        {isActive && <Check className="h-3.5 w-3.5 shrink-0" />}
      </button>
      <button
        type="button"
        onClick={onEdit}
        title={`Edit ${group.code}`}
        aria-label={`Edit ${group.code}`}
        className="shrink-0 rounded p-1 text-current opacity-0 transition-opacity group-hover/row:opacity-70 focus-visible:opacity-100"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}
