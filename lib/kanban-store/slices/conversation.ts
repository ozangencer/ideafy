import {
  BackgroundProcess,
  BackgroundStopNotice,
  ConversationActivityEntry,
  ConversationMessage,
  SectionType,
  SessionStatusStep,
} from "../../types";
import { appendActivity, sealActivity } from "../../conversation-activity";
import { nowIso, parseJson } from "../helpers";
import { KanbanStore, StoreSlice } from "../types";

type StreamEvent = { type: string; data: unknown };

/**
 * Visible text means the thought that was growing in the Live Activity strip
 * is finished: close it so the next `thinking` delta opens its own row.
 */
function sealedActivityLog(
  message: Pick<ConversationMessage, "activityLog">,
): ConversationActivityEntry[] | undefined {
  return message.activityLog ? sealActivity(message.activityLog) : message.activityLog;
}

/**
 * Fold one chat-stream event into the streaming bubble. Shared by sendMessage
 * and attachLiveStream so both paths render the same bubble for the same
 * events. Returns the same object when the event changes nothing.
 */
function applyStreamEvent(
  message: ConversationMessage,
  event: StreamEvent,
): ConversationMessage {
  switch (event.type) {
    case "start": {
      // Adopt the DB-assigned id so when the message is later promoted into
      // `messages[]` (close handler), React's `key={message.id}` reconciles to
      // the SAME DOM node instead of unmount+mount — which was the residual
      // ms-scale flicker after the duplicate-render fix.
      const messageId = (event.data as { messageId?: string } | null)?.messageId;
      return messageId ? { ...message, id: messageId } : message;
    }
    case "status":
      return {
        ...message,
        statusSteps: [...(message.statusSteps ?? []), event.data as SessionStatusStep],
      };
    case "text":
      return {
        ...message,
        content: message.content + (event.data as string),
        activityLog: sealedActivityLog(message),
      };
    case "text_replace":
      return {
        ...message,
        content: String(event.data ?? ""),
        activityLog: sealedActivityLog(message),
      };
    case "thinking": {
      // Partial-message deltas arrive token by token. Keep them verbatim
      // (no trim) so the reducer can stitch "saniye " + "sürecek" back
      // into one row instead of four.
      const delta = String(event.data ?? "");
      if (!delta) return message;
      const activityLog = appendActivity(message.activityLog, { type: "thinking", content: delta });
      return activityLog === message.activityLog ? message : { ...message, activityLog };
    }
    case "tool_use": {
      const toolData = event.data as { name: string };
      return {
        ...message,
        activityLog: appendActivity(message.activityLog, {
          type: "tool_use",
          content: `Using: ${toolData.name}`,
        }),
        activeToolCall: { name: toolData.name, status: "running" },
      };
    }
    case "tool_result": {
      const toolData = event.data as { name?: string };
      return {
        ...message,
        activityLog: appendActivity(message.activityLog, {
          type: "tool_result",
          content: `Result from: ${toolData.name || "tool"}`,
        }),
        activeToolCall: message.activeToolCall
          ? { ...message.activeToolCall, status: "completed" }
          : undefined,
      };
    }
    default:
      return message;
  }
}

/** Yield the parsed `data:` events of an SSE body, skipping malformed ones. */
async function* readStreamEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const messages = buffer.split("\n\n");
    buffer = messages.pop() || "";
    for (const message of messages) {
      if (!message.trim()) continue;
      const match = message.match(/^data:\s*(.+)$/m);
      if (!match) continue;
      try {
        yield JSON.parse(match[1]) as StreamEvent;
      } catch {
        // Invalid JSON, skip
      }
    }
  }
}

function newStreamingMessage(
  cardId: string,
  sectionType: SectionType,
  runId: string,
): ConversationMessage {
  return {
    id: `streaming-${Date.now()}`,
    cardId,
    sectionType,
    role: "assistant",
    content: "",
    mentions: [],
    activityLog: [],
    createdAt: nowIso(),
    isStreaming: true,
    runId,
  };
}

function newRunId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Drop the bubble at `key`, but only if `runId` still owns it. A run that lost
 * its key to a newer run (reattach, a fresh send) must not wipe the newcomer.
 */
function withoutRun(
  streams: Record<string, ConversationMessage>,
  key: string,
  runId: string,
): Record<string, ConversationMessage> {
  if (streams[key]?.runId !== runId) return streams;
  const rest = { ...streams };
  delete rest[key];
  return rest;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const rest = { ...record };
  delete rest[key];
  return rest;
}

export const createConversationSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "conversations"
    | "streamingMessages"
    | "conversationAbortControllers"
    | "conversationError"
    | "backgroundStopNotices"
    | "mcpWriteVersion"
    | "mcpWriteCardId"
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
> = (set, get) => {
  /**
   * Apply `fn` to the bubble at `key` only while `runId` owns it. Every write
   * a stream loop makes goes through here, so two chats running at once can
   * never write into each other's bubble.
   */
  const patchStream = (
    key: string,
    runId: string,
    fn: (message: ConversationMessage) => ConversationMessage,
  ) =>
    set((state) => {
      const current = state.streamingMessages[key];
      if (!current || current.runId !== runId) return state;
      const next = fn(current);
      if (next === current) return state;
      return { streamingMessages: { ...state.streamingMessages, [key]: next } };
    });

  /** The `close` event lists the background tasks the turn's exit stopped. */
  const recordStrandedTasks = (key: string, data: unknown) => {
    const { messageId, strandedTasks } = (data ?? {}) as {
      messageId?: string;
      strandedTasks?: BackgroundStopNotice["tasks"];
    };
    if (!messageId || !strandedTasks?.length) return;
    set((state) => ({
      backgroundStopNotices: {
        ...state.backgroundStopNotices,
        [key]: { messageId, tasks: strandedTasks },
      },
    }));
  };

  /**
   * Stream finished: refresh server-side messages, refresh
   * background-processes, and clear this run's bubble in a SINGLE set() so
   * React never renders an interim state where (a) the assistant message
   * exists in both `messages` and the streaming bubble (duplicate bubble) or
   * (b) the bubble is gone while `isBackgroundProcessing` is still stale-true
   * (which would surface the "Thinking…" placeholder for a single ms-scale
   * frame).
   */
  const finishStream = async (
    cardId: string,
    sectionType: SectionType,
    runId: string,
    hadToolCalls: boolean,
  ) => {
    const key = `${cardId}-${sectionType}`;
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
          [key]: Array.isArray(fresh) ? fresh : state.conversations[key] || [],
        },
        streamingMessages: withoutRun(state.streamingMessages, key, runId),
        backgroundProcesses: Array.isArray(bg) ? bg : state.backgroundProcesses,
      }));
    } catch {
      set((state) => ({ streamingMessages: withoutRun(state.streamingMessages, key, runId) }));
    }
    if (hadToolCalls) {
      await get().fetchCards();
      // Signal to open card modals that the latest selectedCard refresh is
      // server-driven (MCP write) and should win over any local form state,
      // even if the form thinks it has unsaved edits (the diff IS the MCP
      // write).
      set((state) => ({ mcpWriteVersion: state.mcpWriteVersion + 1, mcpWriteCardId: cardId }));
    }
  };

  return {
    conversations: {},
    streamingMessages: {},
    conversationAbortControllers: {},
    conversationError: null,
    backgroundStopNotices: {},
    mcpWriteVersion: 0,
    mcpWriteCardId: null,
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
      const runId = newRunId();

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

      const abortController = new AbortController();
      set((state) => ({
        backgroundStopNotices: withoutKey(state.backgroundStopNotices, key),
        conversations: {
          ...state.conversations,
          [key]: [...(state.conversations[key] || []), userMessage],
        },
        conversationAbortControllers: {
          ...state.conversationAbortControllers,
          [key]: abortController,
        },
        streamingMessages: {
          ...state.streamingMessages,
          [key]: newStreamingMessage(cardId, sectionType, runId),
        },
      }));

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

        let hadToolCalls = false;
        for await (const event of readStreamEvents(response.body.getReader())) {
          if (event.type === "close") {
            recordStrandedTasks(key, event.data);
            await finishStream(cardId, sectionType, runId, hadToolCalls);
            continue;
          }
          if (event.type === "tool_use" || event.type === "tool_result") hadToolCalls = true;
          patchStream(key, runId, (message) => applyStreamEvent(message, event));
          if (event.type === "start") get().fetchBackgroundProcesses();
        }
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          console.error("Failed to send message:", error);
          set({ conversationError: error.message });
        }
      } finally {
        set((state) => ({
          streamingMessages: withoutRun(state.streamingMessages, key, runId),
          conversationAbortControllers:
            state.conversationAbortControllers[key] === abortController
              ? withoutKey(state.conversationAbortControllers, key)
              : state.conversationAbortControllers,
        }));
      }
    },

    cancelConversation: (cardId, sectionType) => {
      // Stop = user-initiated kill. The chat-stream POST's signal-abort handler
      // intentionally no longer kills the CLI (so modal close / HMR don't drop
      // the stream), so an explicit DELETE is needed to actually terminate the
      // backend process. Abort the local fetch afterward to release the reader.
      const key = `${cardId}-${sectionType}`;
      const { streamingMessages, conversationAbortControllers } = get();
      if (streamingMessages[key]) {
        const params = new URLSearchParams({ sectionType });
        void fetch(`/api/cards/${cardId}/chat-stream?${params.toString()}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
      conversationAbortControllers[key]?.abort();
      set((state) => ({
        streamingMessages: withoutKey(state.streamingMessages, key),
        conversationAbortControllers: withoutKey(state.conversationAbortControllers, key),
      }));
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
      // replays buffered events into a fresh bubble and tails new events until
      // the stream finishes.
      const key = `${cardId}-${sectionType}`;

      // Already attached (sendMessage's loop or an earlier attach is running).
      if (get().streamingMessages[key]) return;

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

      const reader = response.body.getReader();
      // Someone claimed the key while the fetch was in flight.
      if (get().streamingMessages[key]) {
        void reader.cancel().catch(() => undefined);
        return;
      }

      const runId = newRunId();
      set((state) => ({
        streamingMessages: {
          ...state.streamingMessages,
          [key]: newStreamingMessage(cardId, sectionType, runId),
        },
      }));

      let hadToolCalls = false;
      try {
        for await (const event of readStreamEvents(reader)) {
          if (event.type === "close") {
            recordStrandedTasks(key, event.data);
            await finishStream(cardId, sectionType, runId, hadToolCalls);
            continue;
          }
          if (event.type === "tool_use" || event.type === "tool_result") hadToolCalls = true;
          patchStream(key, runId, (message) => applyStreamEvent(message, event));
        }
      } catch {
        // Reader interrupted — the next attach replays the buffer from the start.
      } finally {
        set((state) => ({ streamingMessages: withoutRun(state.streamingMessages, key, runId) }));
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
          backgroundStopNotices: withoutKey(state.backgroundStopNotices, key),
        }));
      } catch (error) {
        console.error("Failed to clear conversation:", error);
      }
    },

    setStreamingMessage: (key, message) =>
      set((state) => ({
        streamingMessages: message
          ? { ...state.streamingMessages, [key]: message }
          : withoutKey(state.streamingMessages, key),
      })),

    appendToStreamingMessage: (key, text) => {
      set((state) => {
        const current = state.streamingMessages[key];
        if (!current) return state;
        return {
          streamingMessages: {
            ...state.streamingMessages,
            [key]: applyStreamEvent(current, { type: "text", data: text }),
          },
        };
      });
    },

    setConversationError: (error) => set({ conversationError: error }),
  };
};
