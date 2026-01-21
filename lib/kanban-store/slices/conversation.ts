import { ConversationMessage, SectionType } from "../../types";
import { nowIso, parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

export const createConversationSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "conversations"
    | "streamingMessage"
    | "isConversationLoading"
    | "conversationAbortController"
    | "fetchConversation"
    | "sendMessage"
    | "cancelConversation"
    | "clearConversation"
    | "setStreamingMessage"
    | "appendToStreamingMessage"
  >
> = (set, get) => ({
  conversations: {},
  streamingMessage: null,
  isConversationLoading: false,
  conversationAbortController: null,

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
        throw new Error("Failed to start chat stream");
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
                  break;
                case "text":
                  fullContent += event.data as string;
                  get().appendToStreamingMessage(event.data as string);
                  break;
                case "tool_use":
                case "tool_result":
                  hadToolCalls = true;
                  break;
                case "close":
                  await get().fetchConversation(cardId, sectionType as SectionType);
                  if (hadToolCalls) {
                    await get().fetchCards();
                  }
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
});
