import {
  BackgroundProcess,
  ConversationActivityEntry,
  ConversationMessage,
  SectionType,
  SessionStatusStep,
} from "../../types";
import { nowIso, parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

function appendActivityEntry(
  existing: ConversationActivityEntry[] | undefined,
  entry: ConversationActivityEntry,
): ConversationActivityEntry[] {
  return [...(existing ?? []), entry].slice(-5);
}

export const createConversationSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "conversations"
    | "streamingMessage"
    | "isConversationLoading"
    | "conversationAbortController"
    | "conversationError"
    | "mcpWriteVersion"
    | "applyMessageVersion"
    | "bumpApplyMessageVersion"
    | "fetchConversation"
    | "sendMessage"
    | "cancelConversation"
    | "detachConversation"
    | "attachLiveStream"
    | "clearConversation"
    | "setStreamingMessage"
    | "appendToStreamingMessage"
    | "setConversationError"
  >
> = (set, get) => ({
  conversations: {},
  streamingMessage: null,
  isConversationLoading: false,
  conversationAbortController: null,
  conversationError: null,
  mcpWriteVersion: 0,
  applyMessageVersion: 0,
  bumpApplyMessageVersion: () =>
    set((state) => ({ applyMessageVersion: state.applyMessageVersion + 1 })),

  fetchConversation: async (cardId, sectionType) => {
    const key = `${cardId}-${sectionType}`;
    try {
      const response = await fetch(
        `/api/cards/${cardId}/conversations?section=${sectionType}`
      );
      const messages = await parseJson<ConversationMessage[]>(response);
      set((state) => ({
        conversations: {
          ...state.conversations,
          [key]: Array.isArray(messages) ? messages : [],
        },
      }));
    } catch (error) {
      console.error("Failed to fetch conversation:", error);
    }
  },

  sendMessage: async (
    cardId,
    sectionType,
    content,
    mentions,
    projectPath,
    currentSectionContent
  ) => {
    const key = `${cardId}-${sectionType}`;

    // Add user message to conversations immediately (optimistic update)
    const userMessage: ConversationMessage = {
      id: `temp-user-${Date.now()}`,
      cardId,
      sectionType,
      role: "user",
      content,
      mentions,
      createdAt: nowIso(),
    };

    set((state) => ({
      conversations: {
        ...state.conversations,
        [key]: [...(state.conversations[key] || []), userMessage],
      },
    }));

    const abortController = new AbortController();
    set({ isConversationLoading: true, conversationAbortController: abortController });

    const streamingId = `streaming-${Date.now()}`;
    set({
      streamingMessage: {
        id: streamingId,
        cardId,
        sectionType,
        role: "assistant",
        content: "",
        mentions: [],
        activityLog: [],
        createdAt: nowIso(),
        isStreaming: true,
      },
    });

    try {
      const response = await fetch(`/api/cards/${cardId}/chat-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionType,
          content,
          mentions,
          projectPath,
          currentSectionContent,
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        let errorMessage = "Failed to start chat stream";
        try {
          const errorBody = await response.json();
          errorMessage = errorBody.error || errorBody.message || errorMessage;
          if (errorBody.suggestion) {
            errorMessage += ` — ${errorBody.suggestion}`;
          }
        } catch {
          // Could not parse error body
        }
        throw new Error(errorMessage);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let assistantMessageId = "";
      let hadToolCalls = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split("\n\n");
        buffer = messages.pop() || "";

        for (const message of messages) {
          if (!message.trim()) continue;

          const match = message.match(/^data:\s*(.+)$/m);
          if (match) {
            try {
              const event = JSON.parse(match[1]) as {
                type: string;
                data: unknown;
              };

              switch (event.type) {
                case "start":
                  assistantMessageId = (event.data as { messageId: string }).messageId;
                  // Align the streaming bubble's id with the DB-assigned id so
                  // when the message is later promoted into `messages[]` (close
                  // handler), React's `key={message.id}` reconciles to the SAME
                  // DOM node instead of unmount+mount — which was the residual
                  // ms-scale flicker after the duplicate-render fix.
                  set((state) => {
                    if (!state.streamingMessage) return state;
                    return {
                      streamingMessage: {
                        ...state.streamingMessage,
                        id: assistantMessageId,
                      },
                    };
                  });
                  // Refresh background processes list
                  get().fetchBackgroundProcesses();
                  break;
                case "status": {
                  const step = event.data as SessionStatusStep;
                  set((state) => {
                    if (!state.streamingMessage) return state;
                    const existing = state.streamingMessage.statusSteps ?? [];
                    return {
                      streamingMessage: {
                        ...state.streamingMessage,
                        statusSteps: [...existing, step],
                      },
                    };
                  });
                  break;
                }
                case "text":
                  fullContent += event.data as string;
                  get().appendToStreamingMessage(event.data as string);
                  break;
                case "text_replace": {
                  const snapshot = String(event.data ?? "");
                  fullContent = snapshot;
                  set((state) => {
                    if (!state.streamingMessage) return state;
                    return {
                      streamingMessage: { ...state.streamingMessage, content: snapshot },
                    };
                  });
                  break;
                }
                case "thinking": {
                  const content = String(event.data || "").trim();
                  if (!content) break;
                  set((state) => {
                    if (!state.streamingMessage) return state;
                    return {
                      streamingMessage: {
                        ...state.streamingMessage,
                        activityLog: appendActivityEntry(
                          state.streamingMessage.activityLog,
                          { type: "thinking", content },
                        ),
                      },
                    };
                  });
                  break;
                }
                case "tool_use": {
                  hadToolCalls = true;
                  const toolData = event.data as { name: string };
                  set((state) => {
                    if (!state.streamingMessage) return state;
                    return {
                      streamingMessage: {
                        ...state.streamingMessage,
                        activityLog: appendActivityEntry(
                          state.streamingMessage.activityLog,
                          { type: "tool_use", content: `Using: ${toolData.name}` },
                        ),
                        activeToolCall: { name: toolData.name, status: "running" },
                      },
                    };
                  });
                  break;
                }
                case "tool_result": {
                  hadToolCalls = true;
                  const toolData = event.data as { name?: string };
                  set((state) => {
                    if (!state.streamingMessage) return state;
                    return {
                      streamingMessage: {
                        ...state.streamingMessage,
                        activityLog: appendActivityEntry(
                          state.streamingMessage.activityLog,
                          { type: "tool_result", content: `Result from: ${toolData.name || "tool"}` },
                        ),
                        activeToolCall: state.streamingMessage.activeToolCall
                          ? { ...state.streamingMessage.activeToolCall, status: "completed" }
                          : undefined,
                      },
                    };
                  });
                  break;
                }
                case "close": {
                  // Atomically: refresh server-side messages, refresh
                  // background-processes, and clear the streaming bubble in a
                  // SINGLE set() so React never renders an interim state where
                  // (a) the assistant message exists in both `messages` and
                  // `streamingMessage` (duplicate bubble) or (b) streamingMessage
                  // is null while `isBackgroundProcessing` is still stale-true
                  // (which would surface the "Thinking…" placeholder for a
                  // single ms-scale frame).
                  try {
                    const [convResp, bgResp] = await Promise.all([
                      fetch(`/api/cards/${cardId}/conversations?section=${sectionType}`),
                      fetch(`/api/processes`),
                    ]);
                    const fresh = await parseJson<ConversationMessage[]>(convResp);
                    const bg = await parseJson<BackgroundProcess[]>(bgResp);
                    set((state) => ({
                      conversations: {
                        ...state.conversations,
                        [key]: Array.isArray(fresh)
                          ? fresh
                          : state.conversations[key] || [],
                      },
                      streamingMessage: null,
                      backgroundProcesses: Array.isArray(bg)
                        ? bg
                        : state.backgroundProcesses,
                    }));
                  } catch {
                    set({ streamingMessage: null });
                  }
                  if (hadToolCalls) {
                    await get().fetchCards();
                    // Signal to open card modals that the latest selectedCard
                    // refresh is server-driven (MCP write) and should win over
                    // any local form state, even if the form thinks it has
                    // unsaved edits (the diff IS the MCP write).
                    set((state) => ({ mcpWriteVersion: state.mcpWriteVersion + 1 }));
                  }
                  break;
                }
              }
            } catch {
              // Invalid JSON, skip
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        console.error("Failed to send message:", error);
        set({ conversationError: error.message });
      }
    } finally {
      set({ isConversationLoading: false, streamingMessage: null, conversationAbortController: null });
    }
  },

  cancelConversation: () => {
    // Stop = user-initiated kill. The chat-stream POST's signal-abort handler
    // intentionally no longer kills the CLI (so modal close / HMR don't drop
    // the stream), so an explicit DELETE is needed to actually terminate the
    // backend process. Abort the local fetch afterward to release the reader.
    const streaming = get().streamingMessage;
    if (streaming) {
      const params = new URLSearchParams({ sectionType: streaming.sectionType });
      void fetch(`/api/cards/${streaming.cardId}/chat-stream?${params.toString()}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
    const controller = get().conversationAbortController;
    if (controller) {
      controller.abort();
    }
    set({ isConversationLoading: false, streamingMessage: null, conversationAbortController: null });
  },

  detachConversation: () => {
    // Modal closed while streaming — keep stream alive so it continues
    // in background. The finally block in sendMessage will clean up
    // when the stream naturally completes.
  },

  attachLiveStream: async (cardId, sectionType) => {
    // Reattach to an in-flight chat stream after the original POST connection
    // was interrupted (modal close, HMR reload). The server keeps the CLI
    // running and mirrors every event into a shared buffer; this action
    // replays buffered events into a fresh streamingMessage and tails new
    // events until the stream finishes.

    const current = get().streamingMessage;
    if (current && current.cardId === cardId && current.sectionType === sectionType) {
      // Already attached (sendMessage's loop is still running in this tab).
      return;
    }

    let response: Response;
    try {
      response = await fetch(
        `/api/cards/${cardId}/chat-stream/live?section=${sectionType}`,
      );
    } catch {
      return;
    }
    if (response.status === 404 || !response.ok || !response.body) {
      return;
    }

    set({
      streamingMessage: {
        id: `streaming-${Date.now()}`,
        cardId,
        sectionType,
        role: "assistant",
        content: "",
        mentions: [],
        activityLog: [],
        createdAt: nowIso(),
        isStreaming: true,
      },
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let hadToolCalls = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split("\n\n");
        buffer = messages.pop() || "";

        for (const message of messages) {
          if (!message.trim()) continue;
          const match = message.match(/^data:\s*(.+)$/m);
          if (!match) continue;
          let event: { type: string; data: unknown };
          try {
            event = JSON.parse(match[1]);
          } catch {
            continue;
          }

          switch (event.type) {
            case "start": {
              // Live-buffer replay re-emits `start` with the DB-assigned
              // messageId. Adopt it as the streaming bubble's id for the
              // same reason as sendMessage's start handler — keeps React
              // key stable across the streaming → completed transition.
              const replayedId = (event.data as { messageId?: string }).messageId;
              if (replayedId) {
                set((state) => {
                  if (!state.streamingMessage) return state;
                  return {
                    streamingMessage: { ...state.streamingMessage, id: replayedId },
                  };
                });
              }
              break;
            }
            case "text":
              get().appendToStreamingMessage(event.data as string);
              break;
            case "text_replace": {
              const snapshot = String(event.data ?? "");
              set((state) => {
                if (!state.streamingMessage) return state;
                return {
                  streamingMessage: { ...state.streamingMessage, content: snapshot },
                };
              });
              break;
            }
            case "thinking": {
              const content = String(event.data || "").trim();
              if (!content) break;
              set((state) => {
                if (!state.streamingMessage) return state;
                return {
                  streamingMessage: {
                    ...state.streamingMessage,
                    activityLog: appendActivityEntry(
                      state.streamingMessage.activityLog,
                      { type: "thinking", content },
                    ),
                  },
                };
              });
              break;
            }
            case "tool_use": {
              hadToolCalls = true;
              const toolData = event.data as { name: string };
              set((state) => {
                if (!state.streamingMessage) return state;
                return {
                  streamingMessage: {
                    ...state.streamingMessage,
                    activityLog: appendActivityEntry(
                      state.streamingMessage.activityLog,
                      { type: "tool_use", content: `Using: ${toolData.name}` },
                    ),
                    activeToolCall: { name: toolData.name, status: "running" },
                  },
                };
              });
              break;
            }
            case "tool_result": {
              hadToolCalls = true;
              const toolData = event.data as { name?: string };
              set((state) => {
                if (!state.streamingMessage) return state;
                return {
                  streamingMessage: {
                    ...state.streamingMessage,
                    activityLog: appendActivityEntry(
                      state.streamingMessage.activityLog,
                      { type: "tool_result", content: `Result from: ${toolData.name || "tool"}` },
                    ),
                    activeToolCall: state.streamingMessage.activeToolCall
                      ? { ...state.streamingMessage.activeToolCall, status: "completed" }
                      : undefined,
                  },
                };
              });
              break;
            }
            case "status": {
              const step = event.data as SessionStatusStep;
              set((state) => {
                if (!state.streamingMessage) return state;
                const existing = state.streamingMessage.statusSteps ?? [];
                return {
                  streamingMessage: {
                    ...state.streamingMessage,
                    statusSteps: [...existing, step],
                  },
                };
              });
              break;
            }
            case "close": {
              // Same atomic-clear treatment as sendMessage's close handler:
              // bundle the fresh-messages refresh, background-processes
              // refresh, and streamingMessage:null into one set() to prevent
              // both the duplicate-render blink and the stale-isBackground
              // placeholder flash during reattach.
              const liveKey = `${cardId}-${sectionType}`;
              try {
                const [convResp, bgResp] = await Promise.all([
                  fetch(`/api/cards/${cardId}/conversations?section=${sectionType}`),
                  fetch(`/api/processes`),
                ]);
                const fresh = await parseJson<ConversationMessage[]>(convResp);
                const bg = await parseJson<BackgroundProcess[]>(bgResp);
                set((state) => ({
                  conversations: {
                    ...state.conversations,
                    [liveKey]: Array.isArray(fresh)
                      ? fresh
                      : state.conversations[liveKey] || [],
                  },
                  streamingMessage: null,
                  backgroundProcesses: Array.isArray(bg)
                    ? bg
                    : state.backgroundProcesses,
                }));
              } catch {
                set({ streamingMessage: null });
              }
              if (hadToolCalls) {
                await get().fetchCards();
                set((state) => ({ mcpWriteVersion: state.mcpWriteVersion + 1 }));
              }
              break;
            }
          }
        }
      }
    } catch {
      // Reader interrupted — keep streamingMessage as-is so the next
      // attach can pick up where this one left off.
      return;
    } finally {
      set({ streamingMessage: null });
    }
  },

  clearConversation: async (cardId, sectionType) => {
    const key = `${cardId}-${sectionType}`;
    try {
      await fetch(`/api/cards/${cardId}/conversations?section=${sectionType}`, {
        method: "DELETE",
      });
      set((state) => ({
        conversations: {
          ...state.conversations,
          [key]: [],
        },
      }));
    } catch (error) {
      console.error("Failed to clear conversation:", error);
    }
  },

  setStreamingMessage: (message) => set({ streamingMessage: message }),

  appendToStreamingMessage: (text) => {
    set((state) => {
      if (!state.streamingMessage) return state;
      return {
        streamingMessage: {
          ...state.streamingMessage,
          content: state.streamingMessage.content + text,
        },
      };
    });
  },

  setConversationError: (error) => set({ conversationError: error }),
});
