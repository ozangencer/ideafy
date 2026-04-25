import { NextRequest } from "next/server";
import {
  getLiveStreamSnapshot,
  liveStreamKey,
  subscribeLiveStream,
} from "@/lib/live-stream-buffer";

// GET /api/cards/[id]/chat-stream/live?section=...
// Replay the in-progress chat stream's buffered events and tail any new ones
// until the underlying CLI process finishes. Used by the card modal to
// reattach to a stream after the original POST connection was interrupted
// (modal close, HMR reload, network blip).
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: cardId } = await context.params;
  const { searchParams } = new URL(request.url);
  const sectionType = searchParams.get("section");

  if (!sectionType) {
    return new Response(JSON.stringify({ error: "section required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const key = liveStreamKey(cardId, sectionType);
  const snapshot = getLiveStreamSnapshot(key);

  if (!snapshot) {
    return new Response(JSON.stringify({ error: "no live stream" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;
      const send = (event: { type: string; data: unknown }) => {
        if (isClosed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          isClosed = true;
        }
      };

      // Replay buffered history first.
      for (const event of snapshot.events) send(event);

      if (snapshot.done) {
        // Stream already finished between the snapshot read and now — emit a
        // synthetic close so the client knows to refresh from the DB.
        send({ type: "close", data: { replayed: true } });
        if (!isClosed) {
          isClosed = true;
          controller.close();
        }
        return;
      }

      const unsubscribe = subscribeLiveStream(key, (event) => {
        if (event.type === "__buffer_done") {
          send({ type: "close", data: { replayed: false } });
          unsubscribe();
          if (!isClosed) {
            isClosed = true;
            controller.close();
          }
          return;
        }
        send(event);
      });

      request.signal.addEventListener("abort", () => {
        unsubscribe();
        isClosed = true;
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
