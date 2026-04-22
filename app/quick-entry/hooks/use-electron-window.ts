import { RefObject, useCallback, useEffect } from "react";

interface ElectronQuickEntryAPI {
  resizeWindow?: (height: number) => void;
  closeQuickEntryWindow?: () => void;
}

function getApi(): ElectronQuickEntryAPI | undefined {
  return (window as unknown as { electronAPI?: ElectronQuickEntryAPI }).electronAPI;
}

/**
 * Wires the quick-entry window to Electron: transparent background,
 * auto-resize to match content height, and a `closeWindow` callback.
 */
export function useElectronWindow(containerRef: RefObject<HTMLElement | null>) {
  // Force transparent background on the root & body so the window matches the card surface.
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const api = getApi();
    if (!api?.resizeWindow) return;

    const resize = api.resizeWindow;
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (h > 0) resize(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const closeWindow = useCallback(() => {
    const api = getApi();
    api?.closeQuickEntryWindow?.();
  }, []);

  return { closeWindow };
}
