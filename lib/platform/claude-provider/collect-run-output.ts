import type {
  ParsedRunOutput,
  RunOutputCandidate,
  RunOutputCollector,
} from "../types";

/**
 * A single pending line is held until its newline arrives. One `Read` of a big
 * file is one enormous line, so cap it — a 32MB tool result is plausible, a
 * 32MB block of assistant prose is not.
 */
const MAX_PENDING_LINE = 32 * 1024 * 1024;

/** Ceiling on the legacy single-envelope buffer (see `rawFallback` below). */
const MAX_RAW_FALLBACK = 8 * 1024 * 1024;

interface TextBlock {
  type?: string;
  text?: string;
}

/**
 * Collect a Claude Code `stream-json` run into its individual text runs.
 *
 * Deliberately *not* `parseClaudeStreamLine`: that function skips consolidated
 * assistant text because the chat path runs with `--include-partial-messages`
 * and would otherwise double-count. Headless runs omit that flag, so the
 * consolidated blocks are the only text there is.
 */
export function createClaudeRunOutputCollector(): RunOutputCollector {
  let pending = "";
  let droppedOversizedLines = 0;

  // Held only until the first recognisable NDJSON line proves we're talking to
  // a CLI that speaks stream-json. If that never happens (older CLI still
  // emitting one JSON envelope), this is the whole payload and we parse it as
  // such — no worse than the buffering this collector replaced.
  let rawFallback: string | null = "";

  const candidates: RunOutputCandidate[] = [];
  let openRun = "";
  let openRunMessageId: string | null = null;
  let segment = 0;
  let injectedUserMessages = 0;

  let result = "";
  let cost: number | undefined;
  let duration: number | undefined;
  let isError = false;
  let sawResultEnvelope = false;

  function flushRun(followedByToolUse = false): void {
    if (openRun.trim()) {
      candidates.push({ text: openRun, segment, followedByToolUse });
    }
    openRun = "";
    openRunMessageId = null;
  }

  function appendText(messageId: string | null, text: string): void {
    if (!text) return;
    if (openRun) {
      // Blocks of one message are one continuous utterance; a new message id
      // means the model spoke again, so keep them visually separate.
      openRun += messageId && messageId === openRunMessageId ? "" : "\n\n";
    }
    openRun += text;
    openRunMessageId = messageId;
  }

  function handleAssistant(json: Record<string, unknown>): void {
    // Subagent chatter is forwarded with a parent tool-use id; only the main
    // thread's prose can be the run's product.
    if (json.parent_tool_use_id != null) return;

    const message = json.message as { id?: string; content?: TextBlock[] } | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) return;

    const messageId = typeof message?.id === "string" ? message.id : null;

    for (const block of content) {
      if (block?.type === "text" && typeof block.text === "string") {
        appendText(messageId, block.text);
      } else if (block?.type === "tool_use") {
        // The model stopped talking to act — whatever it said is complete.
        flushRun(true);
      }
      // `thinking` is not prose the user asked for; it neither joins nor breaks.
    }
  }

  function handleUser(json: Record<string, unknown>): void {
    if (json.parent_tool_use_id != null) return;

    const message = json.message as { content?: unknown } | undefined;
    const content = message?.content;

    const carriesToolResult =
      Array.isArray(content) &&
      content.some((b) => (b as TextBlock | null)?.type === "tool_result");

    flushRun();

    // Anything reaching the model as a user message that isn't a tool result is
    // an injected re-invocation: a background task notification, a compaction
    // boundary, hook-supplied context. Detecting it structurally rather than by
    // matching `<task-notification>` keeps this working when the harness grows
    // a new injection kind.
    if (!carriesToolResult) {
      segment++;
      injectedUserMessages++;
    }
  }

  function handleResult(json: Record<string, unknown>): void {
    sawResultEnvelope = true;
    result = typeof json.result === "string" ? json.result : String(json.result ?? "");
    // The CLI field is `total_cost_usd`; `cost_usd` is read as a fallback only
    // because that is what this codebase asked for before IDE-280 found it was
    // never actually present.
    const rawCost = json.total_cost_usd ?? json.cost_usd;
    cost = typeof rawCost === "number" ? rawCost : undefined;
    duration = typeof json.duration_ms === "number" ? json.duration_ms : undefined;
    isError = !!json.is_error;
    flushRun();
  }

  function handleLine(line: string): void {
    if (!line.trim()) return;

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(line);
    } catch {
      return;
    }
    if (!json || typeof json !== "object") return;

    switch (json.type) {
      case "assistant":
        handleAssistant(json);
        break;
      case "user":
        handleUser(json);
        break;
      case "result":
        handleResult(json);
        break;
      case "system":
      case "rate_limit_event":
      case "tool_result":
        // Known and deliberately dropped. `system/hook_response` in particular
        // embeds full hook stdout/stderr, which we must not retain.
        break;
      default:
        // Unknown event type — ignore, but it still proves this is NDJSON.
        break;
    }

    // A parseable typed line means the stream-json path is live; the legacy
    // whole-payload buffer is dead weight from here on.
    rawFallback = null;
  }

  return {
    push(chunk: string): void {
      if (rawFallback !== null && rawFallback.length < MAX_RAW_FALLBACK) {
        rawFallback += chunk;
      }

      pending += chunk;
      if (pending.length > MAX_PENDING_LINE) {
        droppedOversizedLines++;
        pending = "";
        return;
      }

      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    },

    finish(): ParsedRunOutput {
      // The terminating `result` line often arrives without a trailing newline,
      // so draining what's left is not optional.
      if (pending) {
        handleLine(pending);
        pending = "";
      }
      flushRun();

      if (rawFallback !== null) {
        // Never saw a typed line: treat the payload as one JSON envelope, the
        // shape older CLIs emit under `--output-format json`.
        try {
          const envelope = JSON.parse(rawFallback);
          const rawCost = envelope.total_cost_usd ?? envelope.cost_usd;
          return {
            candidates: [],
            result: envelope.result || "",
            cost: typeof rawCost === "number" ? rawCost : undefined,
            duration: typeof envelope.duration_ms === "number" ? envelope.duration_ms : undefined,
            isError: !!envelope.is_error,
            sawResultEnvelope: true,
            injectedUserMessages: 0,
          };
        } catch {
          // Not JSON either — hand back the raw text, matching what
          // `parseJsonResponse` has always done with unparseable output.
          return {
            candidates: [],
            result: rawFallback.trim(),
            isError: false,
            sawResultEnvelope: rawFallback.trim().length > 0,
            injectedUserMessages: 0,
          };
        }
      }

      if (droppedOversizedLines > 0) {
        console.warn(
          `[Claude Code] dropped ${droppedOversizedLines} oversized stream line(s) (>${MAX_PENDING_LINE} bytes)`,
        );
      }

      return {
        candidates,
        result,
        cost,
        duration,
        isError,
        sawResultEnvelope,
        injectedUserMessages,
      };
    },
  };
}
