import type { StreamEvent } from "../types";

/**
 * Parse a single line of Claude Code `stream-json` output into zero or more
 * normalized `StreamEvent`s. Unknown or malformed payloads yield `[]` so the
 * caller can ignore them without a try/catch per line.
 */
export function parseClaudeStreamLine(line: string): StreamEvent[] {
  if (!line.trim()) return [];

  try {
    const json = JSON.parse(line);
    const events: StreamEvent[] = [];

    // Assistant messages may carry multiple content blocks (text, thinking, tool_use).
    if (json.type === "assistant" && json.message?.content) {
      for (const block of json.message.content) {
        if (block.type === "text" && block.text) {
          events.push({ type: "text", data: block.text });
        }
        if (block.type === "thinking" && block.thinking) {
          events.push({ type: "thinking", data: block.thinking });
        }
        if (block.type === "tool_use") {
          events.push({ type: "tool_use", data: { name: block.name, input: block.input } });
        }
      }
    }

    // Incremental deltas while an assistant block is streaming.
    if (json.type === "content_block_delta") {
      if (json.delta?.text) {
        events.push({ type: "text", data: json.delta.text });
      }
      if (json.delta?.thinking) {
        events.push({ type: "thinking", data: json.delta.thinking });
      }
    }

    // Tool results — truncate long output so one event doesn't dominate the log.
    if (json.type === "tool_result") {
      events.push({
        type: "tool_result",
        data: { name: json.name, output: json.output?.slice?.(0, 200) },
      });
    }

    // Final result text, emitted after any tool_use round-trips.
    if (json.type === "result" && json.result) {
      events.push({ type: "result", data: String(json.result) });
    }

    // Non-init system notices (e.g. rate limit hints).
    if (json.type === "system" && json.subtype && json.subtype !== "init") {
      events.push({ type: "system", data: { subtype: json.subtype, message: json.message } });
    }

    return events;
  } catch {
    return [];
  }
}
