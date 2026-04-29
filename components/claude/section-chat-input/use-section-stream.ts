import { useCallback, useRef, useState } from "react";
import { marked } from "marked";
import { SectionType } from "@/lib/types";
import { CardContext, SECTION_CONFIG } from "./section-config";

// One-time global configuration — safe to run at module load.
marked.setOptions({ gfm: true, breaks: true });

export interface ActivityEntry {
  type: "thinking" | "tool_use" | "tool_result";
  content: string;
}

interface UseSectionStreamArgs {
  cardId: string;
  sectionType: SectionType;
  cardContext: CardContext;
  projectPath: string;
  onUpdate: (html: string) => void;
}

/**
 * Drives the `/api/cards/:id/section-stream` SSE endpoint: builds the prompt
 * from `SECTION_CONFIG`, streams text/thinking/tool events, exposes activity
 * + partial output state, and hands the final markdown (parsed to HTML) to
 * the caller via `onUpdate`.
 */
export function useSectionStream(args: UseSectionStreamArgs) {
  const { cardId, sectionType, cardContext, projectPath, onUpdate } = args;

  const [isLoading, setIsLoading] = useState(false);
  const [streamingOutput, setStreamingOutput] = useState("");
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const appendActivity = (entry: ActivityEntry) => {
    setActivityLog((prev) => [...prev, entry]);
  };

  const submit = useCallback(
    async (userMessage: string) => {
      if (!userMessage.trim() || isLoading) return;

      setIsLoading(true);
      setError(null);
      setStreamingOutput("");
      setActivityLog([]);

      abortControllerRef.current = new AbortController();

      const config = SECTION_CONFIG[sectionType];
      const systemPrompt = config.systemPrompt(cardContext);
      const fullPrompt = config.userPromptPrefix(cardContext) + userMessage.trim();
      const prompt = `${systemPrompt}\n\n---\n\nUser request:\n${fullPrompt}`;

      try {
        const response = await fetch(`/api/cards/${cardId}/section-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, projectPath, sectionType }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          let serverMessage = `Request failed (HTTP ${response.status})`;
          try {
            const data = await response.json();
            if (data?.error) serverMessage = data.error;
          } catch {
            // body wasn't JSON — fall back to the generic message
          }
          throw new Error(serverMessage);
        }
        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullOutput = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            if (fullOutput.trim()) {
              const html = marked.parse(fullOutput.trim()) as string;
              onUpdate(html);
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const messages = buffer.split("\n\n");
          buffer = messages.pop() || "";

          for (const message of messages) {
            if (!message.trim()) continue;
            const match = message.match(/^data:\s*(.+)$/m);
            if (!match) continue;

            try {
              const event = JSON.parse(match[1]);
              switch (event.type) {
                case "text":
                  fullOutput += event.data;
                  setStreamingOutput(fullOutput);
                  break;
                case "result": {
                  const resultText = String(event.data);
                  if (resultText.trim() && !fullOutput.includes(resultText.trim())) {
                    fullOutput += (fullOutput ? "\n" : "") + resultText;
                    setStreamingOutput(fullOutput);
                  }
                  break;
                }
                case "thinking":
                  appendActivity({ type: "thinking", content: event.data });
                  break;
                case "tool_use":
                  appendActivity({ type: "tool_use", content: `Using: ${event.data.name}` });
                  break;
                case "tool_result":
                  appendActivity({ type: "tool_result", content: `Result from: ${event.data.name}` });
                  break;
                case "error":
                  setError(event.data);
                  break;
              }
            } catch {
              // Invalid JSON, skip.
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // User cancelled — no-op.
        } else {
          const errorMsg = err instanceof Error ? err.message : "Failed to get AI response";
          setError(errorMsg);
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [cardId, sectionType, cardContext, projectPath, onUpdate, isLoading],
  );

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const clear = useCallback(() => {
    setStreamingOutput("");
    setActivityLog([]);
    setError(null);
  }, []);

  return {
    isLoading,
    streamingOutput,
    activityLog,
    error,
    submit,
    cancel,
    clear,
  };
}
