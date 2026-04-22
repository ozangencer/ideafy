"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type { Card, SectionType } from "@/lib/types";

interface UseCardModalFormResetOptions {
  selectedCard: Card | null;
  isDraftMode: boolean;
  activeTab: SectionType;
  setActiveTab: (tab: SectionType) => void;
  fetchConversation: (cardId: string, tab: SectionType) => void;
  autoSaveInFlightRef: MutableRefObject<boolean>;
  cancelPendingAutoSave: () => void;
  markExternalUpdate: () => void;
  applyCardToForm: (card: Card) => void;
  applyCardToGit: (card: Card) => void;
}

export function useCardModalFormReset(options: UseCardModalFormResetOptions) {
  const {
    selectedCard,
    isDraftMode,
    activeTab,
    setActiveTab,
    fetchConversation,
    autoSaveInFlightRef,
    cancelPendingAutoSave,
    markExternalUpdate,
    applyCardToForm,
    applyCardToGit,
  } = options;

  const prevSelectedCardIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedCard) {
      const isNewCard = selectedCard.id !== prevSelectedCardIdRef.current;
      prevSelectedCardIdRef.current = selectedCard.id;

      // Skip form resync when auto-save triggered this selectedCard change
      // Form state is already correct since auto-save reads from form state
      if (!isNewCard && autoSaveInFlightRef.current) {
        return;
      }

      // Cancel any pending auto-save when selectedCard changes externally
      // This prevents auto-save from overwriting MCP tool updates
      cancelPendingAutoSave();
      // Mark this as an external update (possibly from MCP tool calls)
      markExternalUpdate();

      applyCardToForm(selectedCard);
      applyCardToGit(selectedCard);

      // Auto-open Test tab when card is in Human Test column
      if (selectedCard.status === "test") {
        setActiveTab("tests");
      }

      // Fetch conversation for active tab
      if (!isDraftMode) {
        fetchConversation(selectedCard.id, activeTab);
      }
    } else {
      prevSelectedCardIdRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCard, isDraftMode, fetchConversation]);
}
