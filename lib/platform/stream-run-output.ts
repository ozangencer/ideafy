import type {
  CliResponse,
  ParsedRunOutput,
  RunOutputCandidate,
  RunOutputCollector,
  StreamEvent,
} from "./types";

/** Twins of the caps in claude-provider/collect-run-output.ts — same reasoning. */
const MAX_PENDING_LINE = 32 * 1024 * 1024;
const MAX_RAW_FALLBACK = 8 * 1024 * 1024;

/** What a provider's terminating envelope contributes, when it has one. */
export interface TerminalEnvelope {
  result?: string;
  cost?: number;
  duration?: number;
  isError?: boolean;
}

export interface StreamRunOutputOptions {
  /** Provider name, for the oversized-line warning. */
  label: string;
  parseStreamLine(line: string): StreamEvent[];
  /** The provider's buffered parser, used when the stream turns out unreadable. */
  parseJsonResponse(stdout: string): CliResponse;
  /**
   * How consecutive `text` events relate to each other. Codex emits one event
   * per *completed* agent message, so two in a row are two utterances and want
   * a blank line between them; OpenCode streams deltas of a single message and
   * must be concatenated verbatim.
   */
  textEvents?: "delta" | "message";
  /**
   * Pull cost, duration, error state, or a final answer out of a decoded line
   * when the provider emits such an envelope. Deliberately NOT used to decide
   * whether the run finished: these CLIs' terminating event names are not
   * pinned down here the way Claude's `result` is, and guessing one wrong would
   * turn every non-zero exit into a rejected run.
   */
  readTerminal?(json: Record<string, unknown>): TerminalEnvelope | null;
}

/**
 * Decompose a headless run into its individual text runs for any provider whose
 * `parseStreamLine` already understands its event stream.
 *
 * Claude keeps a bespoke collector because its headless stream carries
 * consolidated assistant blocks that `parseClaudeStreamLine` deliberately drops
 * (see that file). Every other provider's stream parser emits exactly the
 * events this needs, so the split lives here once instead of three times.
 *
 * Without this, `runAutonomousCli` falls back to `parseJsonResponse`, which
 * collapses a run to one blob: Codex's quiet mode handed back its entire
 * transcript and OpenCode concatenated every text delta end to end. Both then
 * sailed through `selectRunOutput` as the only candidate there was, so a verify
 * run could write a whole transcript into a card's checklist (IDE-280 is the
 * same failure on the Claude side).
 */
export function createStreamRunOutputCollector(
  options: StreamRunOutputOptions,
): RunOutputCollector {
  const { label, parseStreamLine, parseJsonResponse, readTerminal } = options;
  const textEvents = options.textEvents ?? "delta";

  let pending = "";
  let droppedOversizedLines = 0;

  // Held until the first parseable line proves the CLI really is emitting
  // NDJSON. If that never happens, this is the whole payload and the provider's
  // own buffered parser gets it — no worse than the path this replaces.
  let rawFallback: string | null = "";

  const candidates: RunOutputCandidate[] = [];
  let openRun = "";
  /** Set when the open run came from snapshots rather than deltas. */
  let openRunIsSnapshot = false;
  /**
   * Snapshot text already spent on earlier candidates. Gemini's `text_replace`
   * carries the message so far, and it keeps accumulating across tool calls —
   * so without subtracting what we already emitted, every candidate after the
   * first would repeat all of its predecessors.
   */
  let snapshotBase = "";

  let terminalResult: string | undefined;
  let cost: number | undefined;
  let duration: number | undefined;
  let isError = false;
  let sawParseableLine = false;

  function flushRun(followedByToolUse = false): void {
    if (openRun.trim()) {
      candidates.push({ text: openRun, segment: 0, followedByToolUse });
      if (openRunIsSnapshot) snapshotBase += openRun;
    }
    openRun = "";
    openRunIsSnapshot = false;
  }

  function handleEvent(event: StreamEvent): void {
    switch (event.type) {
      case "text": {
        const text = String(event.data ?? "");
        if (!text) return;
        if (openRun && textEvents === "message") openRun += "\n\n";
        openRun += text;
        return;
      }
      case "text_replace": {
        const snapshot = String(event.data ?? "");
        openRun = snapshot.startsWith(snapshotBase)
          ? snapshot.slice(snapshotBase.length)
          : snapshot;
        openRunIsSnapshot = true;
        return;
      }
      case "tool_use":
        // The model stopped talking to act — whatever it said is complete.
        flushRun(true);
        return;
      default:
        // `thinking`, `tool_result`, `session_id`, `system`: not the product.
        return;
    }
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

    sawParseableLine = true;
    rawFallback = null;

    const terminal = readTerminal?.(json);
    if (terminal) {
      if (terminal.result !== undefined) terminalResult = terminal.result;
      if (terminal.cost !== undefined) cost = terminal.cost;
      if (terminal.duration !== undefined) duration = terminal.duration;
      if (terminal.isError) isError = true;
    }

    for (const event of parseStreamLine(line)) handleEvent(event);
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
      // The last line often arrives without a trailing newline.
      if (pending) {
        handleLine(pending);
        pending = "";
      }
      flushRun();

      if (!sawParseableLine) {
        const raw = rawFallback ?? "";
        const legacy = parseJsonResponse(raw);
        return {
          candidates: [],
          result: legacy.result,
          cost: legacy.cost,
          duration: legacy.duration,
          isError: legacy.isError,
          sawResultEnvelope: !!raw.trim(),
          injectedUserMessages: 0,
        };
      }

      if (droppedOversizedLines > 0) {
        console.warn(
          `[${label}] dropped ${droppedOversizedLines} oversized stream line(s) (>${MAX_PENDING_LINE} bytes)`,
        );
      }

      return {
        candidates,
        // These CLIs have no "the run's answer" field of their own, so the last
        // thing said stands in — which is only ever a fallback for an empty
        // candidate list and for the error path.
        result: terminalResult ?? candidates[candidates.length - 1]?.text ?? "",
        cost,
        duration,
        isError,
        // A readable stream is a weaker claim than Claude's `result` envelope,
        // but it is strictly stronger than what the buffered path asserted
        // (`sawResultEnvelope: !!stdout.trim()`), so the crash guard in
        // `runAutonomousCli` behaves at least as well as it did before.
        sawResultEnvelope: sawParseableLine,
        // These streams carry no harness re-invocations to count.
        injectedUserMessages: 0,
      };
    },
  };
}
