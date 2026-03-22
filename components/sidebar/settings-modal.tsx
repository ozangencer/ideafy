"use client";

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
import { Folder, RefreshCw, Check, AlertCircle, Wifi, WifiOff } from "lucide-react";
import { PlatformIcon } from "@/components/icons/platform-icons";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { settings, updateSettings, fetchSettings } = useKanbanStore();
  const [aiPlatform, setAiPlatform] = useState<AiPlatform>(DEFAULT_SETTINGS.aiPlatform);
  const [skillsPath, setSkillsPath] = useState(DEFAULT_SETTINGS.skillsPath);
  const [mcpConfigPath, setMcpConfigPath] = useState(DEFAULT_SETTINGS.mcpConfigPath);
  const [terminalApp, setTerminalApp] = useState<TerminalApp>(DEFAULT_SETTINGS.terminalApp);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPickingSkillsFolder, setIsPickingSkillsFolder] = useState(false);
  const [isPickingMcpFile, setIsPickingMcpFile] = useState(false);
  const [isReinstallingHooks, setIsReinstallingHooks] = useState(false);
  const [hookResult, setHookResult] = useState<{ success: number; failed: number } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "testing" | "success" | "error">("idle");

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
        mcpConfigFormat: "json",
      },
    },
    codex: {
      skillsPath: "~/.codex/skills",
      mcpConfigPath: "~/.codex/config.toml",
      capabilities: {
        supportsAutonomousMode: true,
        supportsStreamJson: false,
        supportsPermissionModes: false,
        supportsHooks: false,
        supportsSkills: true,
        supportsMcp: true,
        mcpConfigFormat: "toml",
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

  const handleReinstallHooks = async () => {
    setIsReinstallingHooks(true);
    setHookResult(null);
    try {
      const response = await fetch("/api/projects/reinstall-hooks", {
        method: "POST",
      });
      const data = await response.json();
      const results = data.results || [];
      setHookResult({
        success: results.filter((r: { success: boolean }) => r.success).length,
        failed: results.filter((r: { success: boolean }) => !r.success).length,
      });
    } catch (error) {
      console.error("Failed to reinstall hooks:", error);
      setHookResult({ success: 0, failed: -1 });
    } finally {
      setIsReinstallingHooks(false);
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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          {/* AI Platform */}
          <div className="grid gap-2">
            <label htmlFor="aiPlatform" className="text-sm font-medium">
              AI Platform
            </label>
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
            <p className="text-xs text-muted-foreground">
              {platformOption?.description || "Select the AI coding CLI to use"}
            </p>
          </div>

          {/* Skills Path - only if platform supports skills */}
          {capabilities?.supportsSkills && (
            <div className="grid gap-2">
              <label htmlFor="skillsPath" className="text-sm font-medium">
                Skills Directory
              </label>
              <div className="flex gap-2">
                <Input
                  id="skillsPath"
                  value={skillsPath}
                  onChange={(e) => setSkillsPath(e.target.value)}
                  placeholder="~/.claude/skills"
                  className="flex-1"
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
              <p className="text-xs text-muted-foreground">
                Path to skills directory
              </p>
            </div>
          )}

          {/* MCP Config Path - only if platform supports MCP */}
          {capabilities?.supportsMcp && (
            <div className="grid gap-2">
              <label htmlFor="mcpConfigPath" className="text-sm font-medium">
                MCP Configuration File
              </label>
              <div className="flex gap-2">
                <Input
                  id="mcpConfigPath"
                  value={mcpConfigPath}
                  onChange={(e) => setMcpConfigPath(e.target.value)}
                  placeholder={mcpConfigPath}
                  className="flex-1"
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
              <p className="text-xs text-muted-foreground">
                Path to MCP configuration {capabilities.mcpConfigFormat === "toml" ? "TOML" : "JSON"} file
              </p>
            </div>
          )}

          {/* Terminal App Selection */}
          <div className="grid gap-2">
            <label htmlFor="terminalApp" className="text-sm font-medium">
              Terminal Application
            </label>
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
            <p className="text-xs text-muted-foreground">
              {terminalApp === "ghostty"
                ? "Ghostty will open and command will be copied to clipboard"
                : "Terminal to use for opening coding sessions"}
            </p>
          </div>

          {/* Divider - only show if hooks are supported */}
          {capabilities?.supportsHooks && (
            <>
              <div className="border-t border-border" />

              {/* Hooks */}
              <div className="grid gap-2">
                <label className="text-sm font-medium">Hooks</label>
                <p className="text-xs text-muted-foreground mb-2">
                  Reminds you to update cards on every message
                </p>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleReinstallHooks}
                    disabled={isReinstallingHooks}
                    className="gap-2"
                  >
                    <RefreshCw className={`h-4 w-4 ${isReinstallingHooks ? "animate-spin" : ""}`} />
                    {isReinstallingHooks ? "Installing..." : "Install Hooks"}
                  </Button>
                  {hookResult && (
                    <div className="flex items-center gap-2 text-sm">
                      {hookResult.failed === -1 ? (
                        <span className="text-destructive flex items-center gap-1">
                          <AlertCircle className="h-4 w-4" />
                          Error occurred
                        </span>
                      ) : (
                        <>
                          <span className="text-green-500 flex items-center gap-1">
                            <Check className="h-4 w-4" />
                            {hookResult.success} successful
                          </span>
                          {hookResult.failed > 0 && (
                            <span className="text-destructive flex items-center gap-1">
                              <AlertCircle className="h-4 w-4" />
                              {hookResult.failed} failed
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
