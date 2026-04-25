// In-memory replay buffer for in-flight chat streams. The chat-stream POST
// route writes every SSE event here in addition to its own response body so a
// late-joining client (e.g. a card modal that was closed mid-stream and then
// reopened) can replay everything that happened so far via the /live endpoint
// and then keep receiving new events until the stream finishes.
//
// The route's POST response body is NOT a long-lived connection — when the
// browser tab unmounts the modal, React/Next/HMR can interrupt the in-flight
// fetch reader loop. The server-side child process keeps running, but the
// client loses every text/tool/thinking event after that point. This buffer
// closes that gap without relying on the original POST connection.

export type LiveStreamEvent = {
  type: string;
  data: unknown;
};

type Subscriber = (event: LiveStreamEvent) => void;

interface BufferEntry {
  events: LiveStreamEvent[];
  done: boolean;
  subscribers: Set<Subscriber>;
}

const g = globalThis as unknown as {
  __ideafy_liveStreamBuffer?: Map<string, BufferEntry>;
};

if (!g.__ideafy_liveStreamBuffer) {
  g.__ideafy_liveStreamBuffer = new Map<string, BufferEntry>();
}

const buffer = g.__ideafy_liveStreamBuffer;

const MAX_EVENTS_PER_STREAM = 2_000;

export function startLiveStream(key: string): void {
  buffer.set(key, { events: [], done: false, subscribers: new Set() });
}

export function pushLiveStreamEvent(key: string, event: LiveStreamEvent): void {
  const entry = buffer.get(key);
  if (!entry) return;
  if (entry.events.length < MAX_EVENTS_PER_STREAM) {
    entry.events.push(event);
  }
  for (const sub of Array.from(entry.subscribers)) {
    try {
      sub(event);
    } catch {
      // Ignore subscriber errors so one bad listener can't break the stream.
    }
  }
}

export function completeLiveStream(key: string): void {
  const entry = buffer.get(key);
  if (!entry) return;
  entry.done = true;
  // Notify subscribers via a synthetic terminator so they can detach.
  for (const sub of Array.from(entry.subscribers)) {
    try {
      sub({ type: "__buffer_done", data: null });
    } catch {
      // Ignore subscriber errors.
    }
  }
  // Drop the entry shortly after completion so the buffer doesn't grow
  // unbounded across many sessions. A short delay lets brand-new subscribers
  // still catch the final replay if they join right at the close moment.
  setTimeout(() => {
    if (buffer.get(key)?.done) buffer.delete(key);
  }, 30_000);
}

export function getLiveStreamSnapshot(key: string): BufferEntry | undefined {
  return buffer.get(key);
}

export function subscribeLiveStream(key: string, sub: Subscriber): () => void {
  const entry = buffer.get(key);
  if (!entry) return () => undefined;
  entry.subscribers.add(sub);
  return () => {
    entry.subscribers.delete(sub);
  };
}

export function liveStreamKey(cardId: string, sectionType: string): string {
  return `${cardId}-${sectionType}`;
}
