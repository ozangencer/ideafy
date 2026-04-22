import { RefObject, useCallback, useEffect, useRef } from "react";

interface AutoScrollArgs {
  messageCount: number;
  isStreaming: boolean;
}

/**
 * Keeps a scrollable container pinned to the bottom as long as the user
 * hasn't scrolled up themselves.
 *
 * Scrolls on:
 * - new message arrival (messageCount increases)
 * - active streaming (each update ticks this)
 * - container resize (e.g. the chat input grows taller after Shift+Enter)
 *
 * The returned `handleScroll` must be wired to the container's onScroll so
 * the "user scrolled up" bit can be detected.
 */
export function useAutoScrollToBottom<T extends HTMLElement>(
  scrollRef: RefObject<T | null>,
  { messageCount, isStreaming }: AutoScrollArgs,
) {
  const userScrolledUpRef = useRef(false);
  const prevCountRef = useRef(messageCount);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    // Consider "at bottom" if within 50px of the bottom edge.
    userScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 50;
  }, [scrollRef]);

  useEffect(() => {
    const isNewMessage = messageCount > prevCountRef.current;
    prevCountRef.current = messageCount;

    if (scrollRef.current && (isNewMessage || isStreaming) && !userScrolledUpRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messageCount, isStreaming, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!userScrolledUpRef.current && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);

  return { handleScroll };
}
