"use client";

import type { ReactNode } from "react";
import { useState, useEffect, useRef } from "react";
import { useKanbanStore } from "@/lib/store";
import { TERMINAL_OPTIONS, DEFAULT_SETTINGS, AI_PLATFORM_OPTIONS } from "@/lib/types";
import type { TerminalApp, AiPlatform, AppSettings } from "@/lib/types";
import type { PlatformCapabilities } from "@/lib/platform/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Folder, RefreshCw, Check, AlertCircle, Wifi, WifiOff } from "lucide-react";
import { PlatformIcon } from "@/components/icons/platform-icons";
import { useTheme } from "next-themes";
import {
  isPureWhiteEnabled,
  setPureWhiteEnabled,
} from "@/components/theme-provider";
import { PluginUpdateBadge } from "./plugin-update-badge";

export interface SettingsExtraTab {
  value: string;
  trigger: ReactNode;
  content: ReactNode;
  hideDefaultFooter?: boolean;
}

interface SettingsModalProps {
  onClose: () => void;
  extraTabs?: SettingsExtraTab[];
  defaultTab?: string;
  generalTabExtras?: ReactNode;
}

export function SettingsModal({ onClose, extraTabs = [], defaultTab, generalTabExtras }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<string>(defaultTab || "general");
  const hasExtraTabs = extraTabs.length > 0;
  const activeExtra = extraTabs.find((t) => t.value === activeTab);
  const hideDefaultFooter = Boolean(activeExtra?.hideDefaultFooter);

  const {
    settings,
    updateSettings,
    fetchSettings,
    fetchSkills,
    fetchMcps,
    fetchAgents,
    fetchProjectExtensions,
    activeProjectId,
  } = useKanbanStore();
  const [aiPlatform, setAiPlatform] = useState<AiPlatform>(DEFAULT_SETTINGS.aiPlatform);
  const [skillsPath, setSkillsPath] = useState(DEFAULT_SETTINGS.skillsPath);
  const [mcpConfigPath, setMcpConfigPath] = useState(DEFAULT_SETTINGS.mcpConfigPath);
  const [terminalApp, setTerminalApp] = useState<TerminalApp>(DEFAULT_SETTINGS.terminalApp);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPickingSkillsFolder, setIsPickingSkillsFolder] = useState(false);
  const [isPickingMcpFile, setIsPickingMcpFile] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "testing" | "success" | "error">("idle");

  const [pluginStatus, setPluginStatus] = useState<{
    installed: boolean;
    enabled: boolean;
    version: string | null;
  } | null>(null);
  const [isPluginBusy, setIsPluginBusy] = useState(false);
  const [pluginError, setPluginError] = useState<string | null>(null);

  // Appearance
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [pureWhite, setPureWhite] = useState(false);
  useEffect(() => {
    setPureWhite(isPureWhiteEnabled());
  }, []);
  const activeTheme = (theme === "system" ? resolvedTheme : theme) ?? "dark";

  // Track capabilities based on selected platform
  const [capabilities, setCapabilities] = useState<PlatformCapabilities | null>(null);

  useEffect(() => {
    if (!settings) {
      fetchSettings();
    }
  }, [settings, fetchSettings]);

  useEffect(() => {
    if (settings) {
      setAiPlatform(settings.aiPlatform);
      setSkillsPath(settings.skillsPath);
      setMcpConfigPath(settings.mcpConfigPath);
      setTerminalApp(settings.terminalApp);
      // Sync the ref so the platform-change effect doesn't fire on initial load
      prevPlatformRef.current = settings.aiPlatform;

      // Get capabilities from the extended settings response
      const extSettings = settings as AppSettings & { platformCapabilities?: PlatformCapabilities };
      if (extSettings.platformCapabilities) {
        setCapabilities(extSettings.platformCapabilities);
      }
    }
  }, [settings]);

  useEffect(() => {
    if (aiPlatform !== "claude") {
      setPluginStatus(null);
      return;
    }
    let cancelled = false;
    fetch("/api/integrations/claude-code")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setPluginStatus(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [aiPlatform]);

  // Platform defaults for path and capabilities
  const PLATFORM_DEFAULTS: Record<AiPlatform, {
    skillsPath: string;
    mcpConfigPath: string;
    capabilities: PlatformCapabilities;
  }> = {
    claude: {
      skillsPath: "~/.claude/skills",
      mcpConfigPath: "~/.claude.json",
      capabilities: {
        supportsAutonomousMode: true,
        supportsStreamJson: true,
        supportsPermissionModes: true,
        supportsHooks: true,
        supportsSkills: true,
        supportsMcp: true,
        supportsAgents: true,
        supportsSessionResume: true,
        mcpConfigFormat: "json",
      },
    },
    gemini: {
      skillsPath: "~/.gemini/skills",
      mcpConfigPath: "~/.gemini/settings.json",
      capabilities: {
        supportsAutonomousMode: true,
        supportsStreamJson: true,
        supportsPermissionModes: false,
        supportsHooks: false,
        supportsSkills: true,
        supportsMcp: true,
        supportsAgents: true,
        supportsSessionResume: true,
        mcpConfigFormat: "json",
      },
    },
    codex: {
      skillsPath: "~/.codex/skills",
      mcpConfigPath: "~/.codex/config.toml",
      capabilities: {
        supportsAutonomousMode: true,
        supportsStreamJson: true,
        supportsPermissionModes: false,
        supportsHooks: false,
        supportsSkills: true,
        supportsMcp: true,
        supportsAgents: true,
        supportsSessionResume: true,
        mcpConfigFormat: "toml",
      },
    },
    opencode: {
      skillsPath: "~/.config/opencode/skills",
      mcpConfigPath: "~/.config/opencode/opencode.json",
      capabilities: {
        supportsAutonomousMode: true,
        supportsStreamJson: true,
        supportsPermissionModes: true,
        supportsHooks: false,
        supportsSkills: true,
        supportsMcp: true,
        supportsAgents: true,
        supportsSessionResume: true,
        mcpConfigFormat: "json",
      },
    },
  };

  // Collect all known default paths to detect "not customized"
  const allDefaultSkillsPaths = Object.values(PLATFORM_DEFAULTS).map((d) => d.skillsPath);
  const allDefaultMcpPaths = Object.values(PLATFORM_DEFAULTS).map((d) => d.mcpConfigPath);

  // Track previous platform to handle multi-hop transitions (Claude → Gemini → Codex)
  const prevPlatformRef = useRef(aiPlatform);

  // Update capabilities and default paths when platform changes locally
  useEffect(() => {
    const prev = prevPlatformRef.current;
    prevPlatformRef.current = aiPlatform;

    // Skip the initial render (when prev === current)
    if (prev === aiPlatform) return;

    const newDefaults = PLATFORM_DEFAULTS[aiPlatform];
    setCapabilities(newDefaults.capabilities);

    // Update paths only if current value is a known default (not user-customized)
    if (allDefaultSkillsPaths.includes(skillsPath)) {
      setSkillsPath(newDefaults.skillsPath);
    }
    if (allDefaultMcpPaths.includes(mcpConfigPath)) {
      setMcpConfigPath(newDefaults.mcpConfigPath);
    }

    // Reset connection status when platform changes
    setConnectionStatus("idle");
  }, [aiPlatform]);

  const handleFolderPick = async (type: "skills" | "mcp") => {
    if (type === "skills") {
      setIsPickingSkillsFolder(true);
    } else {
      setIsPickingMcpFile(true);
    }

    try {
      const response = await fetch("/api/folder-picker");
      const data = await response.json();
      if (data.path) {
        if (type === "skills") {
          setSkillsPath(data.path);
        } else {
          setMcpConfigPath(data.path);
        }
      }
    } catch (error) {
      console.error("Failed to pick folder:", error);
    } finally {
      if (type === "skills") {
        setIsPickingSkillsFolder(false);
      } else {
        setIsPickingMcpFile(false);
      }
    }
  };

  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      await updateSettings({
        aiPlatform,
        skillsPath,
        mcpConfigPath,
        terminalApp,
      });
      onClose();
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePluginAction = async (action: "install" | "uninstall" | "enable" | "disable") => {
    setIsPluginBusy(true);
    setPluginError(null);
    try {
      const response = await fetch("/api/integrations/claude-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok || data.success === false) {
        setPluginError(data.error || `Action '${action}' failed`);
      }
      if (data.status) setPluginStatus(data.status);
      await Promise.all([fetchSkills(), fetchMcps(), fetchAgents()]);
      if (activeProjectId) await fetchProjectExtensions(activeProjectId);
    } catch (error) {
      setPluginError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsPluginBusy(false);
    }
  };

  const handleTestConnection = async () => {
    setConnectionStatus("testing");
    try {
      const response = await fetch(`/api/settings/test-connection?platform=${aiPlatform}`);
      const data = await response.json();
      setConnectionStatus(data.found ? "success" : "error");
    } catch {
      setConnectionStatus("error");
    }
  };

  const platformOption = AI_PLATFORM_OPTIONS.find((o) => o.value === aiPlatform);

  const generalTabBody = (
    <div className="grid gap-3 py-3 px-1">
          {/* Appearance */}
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium">Appearance</label>
              {activeTheme === "light" && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={pureWhite}
                    onChange={(e) => {
                      setPureWhite(e.target.checked);
                      setPureWhiteEnabled(e.target.checked);
                    }}
                    className="h-3.5 w-3.5 cursor-pointer"
                  />
                  Pure white
                </label>
              )}
            </div>
            <Select
              value={activeTheme === "light" ? "paper" : "dark"}
              onValueChange={(value) => setTheme(value === "paper" ? "light" : "dark")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent className="z-[70]">
                <SelectItem value="paper">Paper (warm light)</SelectItem>
                <SelectItem value="dark">Warm dark</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* AI Platform */}
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="aiPlatform" className="text-sm font-medium">AI Platform</label>
              <span className="text-xs text-muted-foreground truncate">
                {platformOption?.description || ""}
              </span>
            </div>
            <div className="flex gap-2">
              <Select
                value={aiPlatform}
                onValueChange={(value) => setAiPlatform(value as AiPlatform)}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select platform" />
                </SelectTrigger>
                <SelectContent className="z-[70]">
                  {AI_PLATFORM_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <span className="flex items-center gap-2">
                        <PlatformIcon platform={option.value} size={14} />
                        {option.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleTestConnection}
                disabled={connectionStatus === "testing"}
                title="Test connection"
              >
                {connectionStatus === "testing" ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : connectionStatus === "success" ? (
                  <Wifi className="h-4 w-4 text-green-500" />
                ) : connectionStatus === "error" ? (
                  <WifiOff className="h-4 w-4 text-destructive" />
                ) : (
                  <Wifi className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Skills + MCP paths in 2-col grid when both present */}
          {(capabilities?.supportsSkills || capabilities?.supportsMcp) && (
            <div className={`grid gap-3 ${capabilities?.supportsSkills && capabilities?.supportsMcp ? "sm:grid-cols-2" : "grid-cols-1"}`}>
              {capabilities?.supportsSkills && (
                <div className="grid gap-1.5 min-w-0">
                  <label htmlFor="skillsPath" className="text-sm font-medium">Skills Directory</label>
                  <div className="flex gap-1.5">
                    <Input
                      id="skillsPath"
                      value={skillsPath}
                      onChange={(e) => setSkillsPath(e.target.value)}
                      placeholder="~/.claude/skills"
                      className="flex-1 min-w-0"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => handleFolderPick("skills")}
                      disabled={isPickingSkillsFolder}
                      title="Browse folders"
                    >
                      <Folder className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {capabilities?.supportsMcp && (
                <div className="grid gap-1.5 min-w-0">
                  <label htmlFor="mcpConfigPath" className="text-sm font-medium">
                    MCP Config <span className="text-xs text-muted-foreground font-normal">({capabilities.mcpConfigFormat === "toml" ? "TOML" : "JSON"})</span>
                  </label>
                  <div className="flex gap-1.5">
                    <Input
                      id="mcpConfigPath"
                      value={mcpConfigPath}
                      onChange={(e) => setMcpConfigPath(e.target.value)}
                      placeholder={mcpConfigPath}
                      className="flex-1 min-w-0"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => handleFolderPick("mcp")}
                      disabled={isPickingMcpFile}
                      title="Browse files"
                    >
                      <Folder className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Terminal App */}
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="terminalApp" className="text-sm font-medium">Terminal Application</label>
              {terminalApp === "ghostty" && (
                <span className="text-xs text-muted-foreground truncate">Opens via AppleScript</span>
              )}
            </div>
            <Select
              value={terminalApp}
              onValueChange={(value) => setTerminalApp(value as TerminalApp)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select terminal" />
              </SelectTrigger>
              <SelectContent className="z-[70]">
                {TERMINAL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {aiPlatform === "claude" && (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium">Claude Code plugin</label>
                <span className="text-xs text-muted-foreground truncate">
                  {pluginStatus?.installed
                    ? `Installed${pluginStatus.version ? ` v${pluginStatus.version}` : ""} · ${pluginStatus.enabled ? "enabled" : "disabled"}`
                    : "MCP + hooks + skills bundle"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {!pluginStatus?.installed ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handlePluginAction("install")}
                    disabled={isPluginBusy}
                    className="gap-1.5"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isPluginBusy ? "animate-spin" : ""}`} />
                    {isPluginBusy ? "Installing…" : "Install"}
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handlePluginAction("install")}
                      disabled={isPluginBusy}
                      className="gap-1.5"
                      title="Reinstall / pull latest"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isPluginBusy ? "animate-spin" : ""}`} />
                      Update
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handlePluginAction(pluginStatus.enabled ? "disable" : "enable")}
                      disabled={isPluginBusy}
                    >
                      {pluginStatus.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handlePluginAction("uninstall")}
                      disabled={isPluginBusy}
                    >
                      Uninstall
                    </Button>
                  </>
                )}
                {!isPluginBusy && (
                  <PluginUpdateBadge
                    installed={pluginStatus?.installed ?? false}
                    scope="user"
                    currentVersion={pluginStatus?.version ?? null}
                  />
                )}
              </div>
              {pluginError && (
                <p className="text-xs text-destructive flex items-start gap-1">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>{pluginError}</span>
                </p>
              )}
            </div>
          )}

          {generalTabExtras}
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[min(620px,calc(100vw-3rem))] h-[min(640px,85vh)] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
          {hasExtraTabs && (
            <TabsList className="w-full mb-2 shrink-0">
              <TabsTrigger value="general" className="flex-1">
                General
              </TabsTrigger>
              {extraTabs.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="flex-1 gap-1.5">
                  {t.trigger}
                </TabsTrigger>
              ))}
            </TabsList>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto">
            <TabsContent value="general" className="mt-0">
              {generalTabBody}
            </TabsContent>
            {extraTabs.map((t) => (
              <TabsContent key={t.value} value={t.value} className="mt-0">
                {t.content}
              </TabsContent>
            ))}
          </div>
        </Tabs>

        {!hideDefaultFooter && (
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
