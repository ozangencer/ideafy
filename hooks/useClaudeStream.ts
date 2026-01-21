import { useState, useCallback, useRef } from "react";

export type StreamStatus = "idle" | "running" | "ready" | "completed" | "error";

interface UseClaudeStreamOptions {
  onOutput?: (text: string) => void;
  onError?: (error: string) => void;
  onComplete?: () => void;
  onReady?: () => void;
}

export function useClaudeStream(options: UseClaudeStreamOptions = {}) {
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cardIdRef = useRef<string | null>(null);

  const start = useCallback(
    async (cardId: string, prompt: string, projectPath: string) => {
      // Reset state
      setOutput("");
      setError(null);
      setStatus("running");
      cardIdRef.current = cardId;

      // Create abort controller for cleanup
      abortControllerRef.current = new AbortController();

      const params = new URLSearchParams({
        prompt,
        projectPath,
      });

      const url = `/api/cards/${cardId}/stream?${params.toString()}`;
      console.log("[useClaudeStream] Starting stream to:", url);

      try {
        const response = await fetch(url, {
          signal: abortControllerRef.current.signal,
        });

        console.log("[useClaudeStream] Response status:", response.status);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        if (!response.body) {
          throw new Error("No response body");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        console.log("[useClaudeStream] Starting to read stream...");

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            console.log("[useClaudeStream] Stream done");
            setStatus("completed");
            options.onComplete?.();
            break;
          }

          // Decode chunk and add to buffer
          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE messages (data: {...}\n\n)
          const messages = buffer.split("\n\n");
          buffer = messages.pop() || ""; // Keep incomplete message in buffer

          for (const message of messages) {
            if (!message.trim()) continue;

            // Parse SSE format: "data: {...}"
            const match = message.match(/^data:\s*(.+)$/m);
            if (match) {
              try {
                const event = JSON.parse(match[1]);
                console.log("[useClaudeStream] Event:", event.type);

                switch (event.type) {
                  case "text":
                    setOutput((prev) => prev + event.data);
                    options.onOutput?.(event.data);
                    break;
                  case "error":
                    setError(event.data);
                    options.onError?.(event.data);
                    break;
                  case "stderr":
                    console.log("[useClaudeStream] stderr:", event.data);
                    break;
                  case "close":
                    console.log("[useClaudeStream] Process closed:", event.data);
                    setStatus("completed");
                    break;
                  case "ready":
                    console.log("[useClaudeStream] Ready for follow-up");
                    setStatus("ready");
                    options.onReady?.();
                    break;
                }
              } catch {
                // Not valid JSON
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          console.log("[useClaudeStream] Aborted");
          setStatus("idle");
        } else {
          console.error("[useClaudeStream] Error:", err);
          setStatus("error");
          setError(err instanceof Error ? err.message : "Failed to run Claude");
        }
      }
    },
    [options]
  );

  // Send follow-up message to existing session
  const sendMessage = useCallback(async (message: string) => {
    if (!cardIdRef.current) {
      console.error("[useClaudeStream] No active session");
      return false;
    }

    setStatus("running");
    setOutput((prev) => prev + "\n\n---\n\n**You:** " + message + "\n\n**Claude:** ");

    try {
      const response = await fetch(`/api/cards/${cardIdRef.current}/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      const data = await response.json();
      if (!data.success) {
        setError(data.error);
        setStatus("error");
        return false;
      }

      return true;
    } catch (err) {
      console.error("[useClaudeStream] Error sending message:", err);
      setError("Failed to send message");
      setStatus("error");
      return false;
    }
  }, []);

  const stop = useCallback(async () => {
    // Abort the fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Call DELETE endpoint to kill the process
    if (cardIdRef.current) {
      try {
        await fetch(`/api/cards/${cardIdRef.current}/stream`, { method: "DELETE" });
      } catch {
        // Ignore errors when stopping
      }
    }

    cardIdRef.current = null;
    setStatus("idle");
  }, []);

  const clear = useCallback(() => {
    setOutput("");
    setError(null);
    setStatus("idle");
    cardIdRef.current = null;
  }, []);

  return {
    output,
    status,
    error,
    start,
    sendMessage,
    stop,
    clear,
    isRunning: status === "running",
    isReady: status === "ready",
  };
}
