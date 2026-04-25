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

    // With --include-partial-messages Claude emits incremental SSE-style
    // chunks wrapped as {type:"stream_event", event:{...}}. Unwrap and emit
    // text/thinking deltas plus an early tool_use signal on content_block_start.
    if (json.type === "stream_event" && json.event) {
      const inner = json.event;
      if (inner.type === "content_block_delta") {
        const delta = inner.delta;
        if (delta?.type === "text_delta" && delta.text) {
          events.push({ type: "text", data: delta.text });
        }
        if (delta?.type === "thinking_delta" && delta.thinking) {
          events.push({ type: "thinking", data: delta.thinking });
        }
      }
      return events;
    }

    // Consolidated assistant message: skip text/thinking (already streamed via
    // partials above to avoid duplication) but capture tool_use with the full
    // input payload — content_block_start fires before input streams in, so
    // the consolidated block is the only source with complete input.
    if (json.type === "assistant" && json.message?.content) {
      for (const block of json.message.content) {
        if (block.type === "tool_use") {
          events.push({ type: "tool_use", data: { name: block.name, input: block.input } });
        }
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
