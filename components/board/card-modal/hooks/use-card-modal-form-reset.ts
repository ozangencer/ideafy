"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type { Card, SectionType } from "@/lib/types";
import { useKanbanStore } from "@/lib/kanban-store";
import { getInitialTabForCard } from "@/lib/card-initial-tab";

interface UseCardModalFormResetOptions {
  selectedCard: Card | null;
  isDraftMode: boolean;
  activeTab: SectionType;
  setActiveTab: (tab: SectionType) => void;
  fetchConversation: (cardId: string, tab: SectionType) => void;
  autoSaveInFlightRef: MutableRefObject<boolean>;
  hasUnsavedChanges: boolean;
  cancelPendingAutoSave: () => void;
  markExternalUpdate: () => void;
  applyCardToForm: (card: Card) => void;
  applyCardToGit: (card: Card) => void;
  // Set by back navigation: the tab to restore instead of the column's tab.
  tabOverrideRef: MutableRefObject<SectionType | null>;
}

export function useCardModalFormReset(options: UseCardModalFormResetOptions) {
  const {
    selectedCard,
    isDraftMode,
    activeTab,
    setActiveTab,
    fetchConversation,
    autoSaveInFlightRef,
    hasUnsavedChanges,
    cancelPendingAutoSave,
    markExternalUpdate,
    applyCardToForm,
    applyCardToGit,
    tabOverrideRef,
  } = options;

  // Latest-value ref so we can read hasUnsavedChanges without making it a
  // dependency (which would re-run this effect on every keystroke and snap
  // the form back to the card mid-edit).
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  const prevSelectedCardIdRef = useRef<string | null>(null);
  const lastSeenMcpWriteVersionRef = useRef<number>(0);
  const lastSeenApplyVersionRef = useRef<number>(0);
  const mcpWriteVersion = useKanbanStore((s) => s.mcpWriteVersion);
  const applyMessageVersion = useKanbanStore((s) => s.applyMessageVersion);

  useEffect(() => {
    if (selectedCard) {
      const isNewCard = selectedCard.id !== prevSelectedCardIdRef.current;
      prevSelectedCardIdRef.current = selectedCard.id;

      // A chat-stream that ran MCP tools just bumped mcpWriteVersion.
      // Force a resync so the form picks up the freshly written fields,
      // bypassing the unsaved-changes guard below — the diff between form
      // and card IS the MCP write, not a real user edit. Only when the write
      // was to this card: a run finishing elsewhere would otherwise wipe the
      // open form, and for a draft that means reapplying the empty draft.
      const mcpJustWrote =
        mcpWriteVersion !== lastSeenMcpWriteVersionRef.current &&
        !isDraftMode &&
        useKanbanStore.getState().mcpWriteCardId === selectedCard.id;
      lastSeenMcpWriteVersionRef.current = mcpWriteVersion;

      // Append/Replace just wrote merged HTML to the card and the cards array
      // has been refreshed; force the form to pick up the new field content
      // even if a stale local edit makes hasUnsavedChanges true.
      const applyJustWrote = applyMessageVersion !== lastSeenApplyVersionRef.current;
      lastSeenApplyVersionRef.current = applyMessageVersion;

      // Skip form resync on same-card updates when the user has a pending
      // edit. Without this, a background selectedCard refresh (MCP poll,
      // store replace after a sibling save, etc.) during the auto-save
      // debounce window snaps the form back to the card's pre-edit values
      // and cancels the pending save — the classic "Global Default won't
      // stick" symptom. `autoSaveInFlightRef` only covers the in-flight
      // fetch, so we also guard on the form's unsaved-changes flag.
      if (
        !isNewCard &&
        !mcpJustWrote &&
        !applyJustWrote &&
        (autoSaveInFlightRef.current || hasUnsavedChangesRef.current)
      ) {
        return;
      }

      // Cancel any pending auto-save when selectedCard changes externally
      // This prevents auto-save from overwriting MCP tool updates
      cancelPendingAutoSave();
      // Mark this as an external update (possibly from MCP tool calls)
      markExternalUpdate();

      applyCardToForm(selectedCard);
      applyCardToGit(selectedCard);

      // Open the tab the card's column calls for — but only on initial open.
      // Re-running this on every resync (e.g. after Append/Replace bumps
      // applyMessageVersion) would yank the user out of the tab they're
      // actively working in.
      let tab = activeTab;
      if (isNewCard) {
        const override = tabOverrideRef.current;
        tabOverrideRef.current = null;
        if (!isDraftMode) {
          tab = override ?? getInitialTabForCard(selectedCard);
          setActiveTab(tab);
        }
      }

      // Fetch conversation for active tab
      if (!isDraftMode) {
        fetchConversation(selectedCard.id, tab);
      }
    } else {
      prevSelectedCardIdRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCard, isDraftMode, fetchConversation, mcpWriteVersion, applyMessageVersion]);
}
