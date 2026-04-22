import { useCallback, useState } from "react";

/**
 * Exposes a folder-picking flow backed by `/api/folder-picker`.
 * Returns the chosen absolute path, or `null` if the user cancelled or the
 * request failed (errors are logged — callers just see `null`).
 */
export function useFolderPicker() {
  const [isPicking, setIsPicking] = useState(false);

  const pickFolder = useCallback(async (): Promise<string | null> => {
    setIsPicking(true);
    try {
      const response = await fetch("/api/folder-picker");
      const data = await response.json();
      return data.path ?? null;
    } catch (error) {
      console.error("Failed to pick folder:", error);
      return null;
    } finally {
      setIsPicking(false);
    }
  }, []);

  return { isPicking, pickFolder };
}
