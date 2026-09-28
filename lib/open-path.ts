// Client-side helpers for opening local files in their default app. Each
// returns "" on success and an error message otherwise, matching
// Electron's shell.openPath contract.

type ElectronOpenAPI = {
  openPath?: (filePath: string) => Promise<string>;
  revealPath?: (filePath: string) => Promise<string>;
};

function getElectronOpenAPI(): ElectronOpenAPI | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { electronAPI?: ElectronOpenAPI }).electronAPI;
}

async function errorFrom(res: Response): Promise<string> {
  if (res.ok) return "";
  try {
    const data = (await res.json()) as { error?: string };
    return data.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function openViaApi(filePath: string, action: "open" | "reveal"): Promise<string> {
  const res = await fetch("/api/open-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action === "reveal" ? { path: filePath, action } : { path: filePath }),
  });
  return errorFrom(res);
}

/** Open a path the user picked themselves (document viewer). No allowlist. */
export async function openLocalPath(filePath: string): Promise<string> {
  const electron = getElectronOpenAPI();
  if (electron?.openPath) return (await electron.openPath(filePath)) || "";
  return openViaApi(filePath, "open");
}

/** Reveal a path the user picked themselves in Finder. No allowlist. */
export async function revealLocalPath(filePath: string): Promise<string> {
  const electron = getElectronOpenAPI();
  if (electron?.revealPath) return (await electron.revealPath(filePath)) || "";
  return openViaApi(filePath, "reveal");
}

/**
 * Open a file linked from card content. Card text can come from MCP callers
 * or a teammate's pool card, so this goes through a route that only opens
 * files inside the card's own folders and reveals executables instead of
 * running them.
 */
export async function openCardArtifact(cardId: string, filePath: string): Promise<string> {
  const res = await fetch(`/api/cards/${cardId}/open-artifact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath }),
  });
  return errorFrom(res);
}
