import { ConversationMessage, SectionType, SessionStatusStep } from "../../types";
import { nowIso, parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

export const createConversationSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "conversations"
    | "streamingMessage"
    | "isConversationLoading"
    | "conversationAbortController"
    | "conversationError"
    | "fetchConversation"
    | "sendMessage"
    | "cancelConversation"
    | "detachConversation"
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
                case "tool_use": {
                  hadToolCalls = true;
                  const toolData = event.data as { name: string };
                  set((state) => {
                    if (!state.streamingMessage) return state;
                    return {
                      streamingMessage: {
                        ...state.streamingMessage,
                        activeToolCall: { name: toolData.name, status: "running" },
                      },
                    };
                  });
                  break;
                }
                case "tool_result": {
                  hadToolCalls = true;
                  set((state) => {
                    if (!state.streamingMessage) return state;
                    return {
                      streamingMessage: {
                        ...state.streamingMessage,
                        activeToolCall: state.streamingMessage.activeToolCall
                          ? { ...state.streamingMessage.activeToolCall, status: "completed" }
                          : undefined,
                      },
                    };
                  });
                  break;
                }
                case "close":
                  await get().fetchConversation(cardId, sectionType as SectionType);
                  if (hadToolCalls) {
                    await get().fetchCards();
                  }
                  // Refresh background processes list
                  get().fetchBackgroundProcesses();
                  break;
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
    const controller = get().conversationAbortController;
    if (controller) {
      controller.abort();
      set({ isConversationLoading: false, streamingMessage: null, conversationAbortController: null });
    }
  },

  detachConversation: () => {
    // Modal closed while streaming — keep stream alive so it continues
    // in background. The finally block in sendMessage will clean up
    // when the stream naturally completes.
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
