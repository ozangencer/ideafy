import { useCallback, useLayoutEffect, useRef, useState } from "react";

export interface PastedImage {
  id: string;
  base64: string;
  mime: string;
  index: number;
}

/**
 * Owns the pasted-image chip state used by the chat input. Chips are shown
 * above the editor (kept out of the TipTap doc so the input height stays
 * stable) and paired with inline `imageAttachment` node markers via `id`.
 *
 * Exposes:
 * - `pastedImages` / `pastedImagesRef` — state + a stable ref (used from
 *   inside editor callbacks that can't depend on React renders)
 * - `addImage` / `removeImage` — mutate the chip list and return metadata
 * - `syncWithIds` — reconcile after editor update (drops chips whose markers
 *   were backspaced out of the doc)
 * - `clear` — reset after send
 */
export function usePastedImages() {
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);
  const pastedImagesRef = useRef<PastedImage[]>([]);
  const indexCounterRef = useRef(0);

  useLayoutEffect(() => {
    pastedImagesRef.current = pastedImages;
  }, [pastedImages]);

  const addImage = useCallback(
    (base64: string, mime: string): { id: string; index: number } => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const index = ++indexCounterRef.current;
      setPastedImages((prev) => [...prev, { id, base64, mime, index }]);
      return { id, index };
    },
    [],
  );

  const removeImage = useCallback((id: string) => {
    setPastedImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const syncWithIds = useCallback((aliveIds: Set<string>) => {
    setPastedImages((prev) => {
      const filtered = prev.filter((img) => aliveIds.has(img.id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, []);

  const clear = useCallback(() => {
    setPastedImages([]);
    indexCounterRef.current = 0;
  }, []);

  return {
    pastedImages,
    pastedImagesRef,
    addImage,
    removeImage,
    syncWithIds,
    clear,
  };
}
