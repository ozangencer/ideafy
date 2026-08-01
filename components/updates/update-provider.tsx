"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Mirrors the state object electron/updater.js broadcasts. */
export type AppUpdateStatus =
  | "unsupported"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

export interface AppUpdateState {
  supported: boolean;
  currentVersion: string;
  status: AppUpdateStatus;
  latestVersion: string | null;
  releaseNotes: string | null;
  percent: number;
  error: string | null;
  lastCheckedAt: number | null;
}

export interface PluginUpdateState {
  loading: boolean;
  installed: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  hasUpdate: boolean;
  minimumVersion: string;
  belowMinimum: boolean;
  error: string | null;
}

interface UpdatesBridge {
  getState(): Promise<AppUpdateState>;
  check(): Promise<AppUpdateState>;
  download(): Promise<AppUpdateState>;
  install(): Promise<AppUpdateState>;
  onState(callback: (state: AppUpdateState) => void): () => void;
}

function getBridge(): UpdatesBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { electronAPI?: { updates?: UpdatesBridge } })
    .electronAPI?.updates;
}

const APP_FALLBACK: AppUpdateState = {
  supported: false,
  currentVersion: "",
  status: "unsupported",
  latestVersion: null,
  releaseNotes: null,
  percent: 0,
  error: null,
  lastCheckedAt: null,
};

const PLUGIN_FALLBACK: PluginUpdateState = {
  loading: true,
  installed: false,
  currentVersion: null,
  latestVersion: null,
  hasUpdate: false,
  minimumVersion: "",
  belowMinimum: false,
  error: null,
};

// Matches the app updater's cadence in electron/updater.js. Both checks are
// cheap (one GitHub request each) and neither is worth doing more often.
const PLUGIN_RECHECK_MS = 4 * 60 * 60 * 1000;

interface UpdatesContextValue {
  app: AppUpdateState;
  plugin: PluginUpdateState;
  pluginBusy: boolean;
  /** Anything the user should act on — drives the sidebar indicator. */
  hasActionableUpdate: boolean;
  checkApp: () => Promise<void>;
  downloadApp: () => Promise<void>;
  installApp: () => Promise<void>;
  refreshPlugin: () => Promise<void>;
  updatePlugin: () => Promise<void>;
}

const UpdatesContext = createContext<UpdatesContextValue | null>(null);

export function UpdatesProvider({ children }: { children: ReactNode }) {
  const [app, setApp] = useState<AppUpdateState>(APP_FALLBACK);
  const [plugin, setPlugin] = useState<PluginUpdateState>(PLUGIN_FALLBACK);
  const [pluginBusy, setPluginBusy] = useState(false);

  // App state is pushed from the main process; seed once, then follow events.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    bridge
      .getState()
      .then((state) => {
        if (!cancelled) setApp(state);
      })
      .catch(() => {});
    const unsubscribe = bridge.onState((state) => setApp(state));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const refreshPlugin = useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/claude-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check-updates", scope: "user" }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as Omit<PluginUpdateState, "loading">;
      setPlugin({ ...data, loading: false, error: data.error ?? null });
    } catch (error) {
      setPlugin((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  // Checking on every mount is what closes the discovery gap the old
  // Settings-only badge left open — including the case that matters most,
  // the first launch after the app itself auto-updated into a new schema.
  useEffect(() => {
    refreshPlugin();
    const timer = setInterval(refreshPlugin, PLUGIN_RECHECK_MS);
    return () => clearInterval(timer);
  }, [refreshPlugin]);

  const checkApp = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    const state = await bridge.check();
    setApp(state);
  }, []);

  const downloadApp = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    await bridge.download();
  }, []);

  const installApp = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    await bridge.install();
  }, []);

  const updatePlugin = useCallback(async () => {
    setPluginBusy(true);
    try {
      const response = await fetch("/api/integrations/claude-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install", scope: "user" }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      await refreshPlugin();
    } catch (error) {
      setPlugin((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setPluginBusy(false);
    }
  }, [refreshPlugin]);

  const hasActionableUpdate =
    app.status === "available" ||
    app.status === "ready" ||
    (plugin.installed && (plugin.hasUpdate || plugin.belowMinimum));

  const value = useMemo(
    () => ({
      app,
      plugin,
      pluginBusy,
      hasActionableUpdate,
      checkApp,
      downloadApp,
      installApp,
      refreshPlugin,
      updatePlugin,
    }),
    [
      app,
      plugin,
      pluginBusy,
      hasActionableUpdate,
      checkApp,
      downloadApp,
      installApp,
      refreshPlugin,
      updatePlugin,
    ],
  );

  return <UpdatesContext.Provider value={value}>{children}</UpdatesContext.Provider>;
}

/**
 * Returns null outside the provider so leaf components (the quick-entry
 * window renders the same bundle without it) can opt out instead of crashing.
 */
export function useUpdates(): UpdatesContextValue | null {
  return useContext(UpdatesContext);
}
