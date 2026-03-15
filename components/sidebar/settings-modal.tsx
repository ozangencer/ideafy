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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Folder, RefreshCw, Check, AlertCircle, Wifi, WifiOff, Copy, LogOut, Users, Share2, Mail, Send } from "lucide-react";
import { PlatformIcon } from "@/components/icons/platform-icons";
import { toast } from "sonner";

interface SettingsModalProps {
  onClose: () => void;
  defaultTab?: "general" | "team";
  defaultInviteCode?: string;
}

export function SettingsModal({ onClose, defaultTab, defaultInviteCode }: SettingsModalProps) {
  const {
    settings, updateSettings, fetchSettings,
    supabaseConfigured, currentUser, teams, activeTeamId, teamMembers,
    signUp, signIn, signInOAuth, signOutUser,
    createTeam, joinTeam, leaveTeam, setActiveTeam,
    updateMemberRole, fetchMembersForTeam,
  } = useKanbanStore();

  // When activeTeamId is "all", resolve to the first team for settings display
  const resolvedTeamId = activeTeamId === "all" && teams.length > 0 ? teams[0].id : activeTeamId;
  const activeTeam = teams.find((t) => t.id === resolvedTeamId) || null;

  // Fetch members for the resolved team when "all" is active
  const [settingsTeamMembers, setSettingsTeamMembers] = useState<typeof teamMembers>([]);
  const displayMembers = activeTeamId === "all" ? settingsTeamMembers : teamMembers;

  useEffect(() => {
    if (activeTeamId === "all" && activeTeam) {
      fetchMembersForTeam(activeTeam.id).then((members) => {
        if (members) setSettingsTeamMembers(members);
      });
    }
  }, [activeTeamId, activeTeam?.id, fetchMembersForTeam]);

  const currentUserRole = displayMembers.find(m => m.userId === currentUser?.id)?.role;
  const isOwnerOrAdmin = currentUserRole === "owner" || currentUserRole === "admin";
  const isOwner = currentUserRole === "owner";
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

  // Team auth state
  const [authTab, setAuthTab] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [inviteCode, setInviteCode] = useState(defaultInviteCode || "");
  const [teamLoading, setTeamLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);

  const handleAuthSubmit = async () => {
    setAuthLoading(true);
    setAuthError(null);
    if (authTab === "signup") {
      const result = await signUp(authEmail, authPassword, authDisplayName);
      if (result.error) setAuthError(result.error);
      else toast.success("Account created. Check email for verification.");
    } else {
      const result = await signIn(authEmail, authPassword);
      if (result.error) setAuthError(result.error);
    }
    setAuthLoading(false);
  };

  const handleCreateTeam = async () => {
    if (!teamName.trim()) return;
    setTeamLoading(true);
    const result = await createTeam(teamName.trim());
    if (result.error) toast.error(result.error);
    else toast.success("Team created!");
    setTeamLoading(false);
    setTeamName("");
  };

  const handleJoinTeam = async () => {
    if (!inviteCode.trim()) return;
    setTeamLoading(true);
    const result = await joinTeam(inviteCode.trim());
    if (result.error) toast.error(result.error);
    else toast.success("Joined team!");
    setTeamLoading(false);
    setInviteCode("");
  };

  const handleLeaveTeam = async (teamId: string) => {
    setTeamLoading(true);
    const result = await leaveTeam(teamId);
    if (result.error) toast.error(result.error);
    else toast.success("Left team");
    setTeamLoading(false);
  };

  const handleSendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteSending(true);
    try {
      const { getSupabaseClient } = await import("@/lib/team/supabase");
      const supabase = getSupabaseClient();
      const session = supabase ? (await supabase.auth.getSession()).data.session : null;
      if (!session?.access_token) {
        toast.error("Not authenticated");
        return;
      }
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ email: inviteEmail.trim(), teamId: activeTeamId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to send invite");
      } else {
        toast.success(`Invite sent to ${inviteEmail.trim()}`);
        setInviteEmail("");
      }
    } catch {
      toast.error("Failed to send invite");
    } finally {
      setInviteSending(false);
    }
  };

  const platformOption = AI_PLATFORM_OPTIONS.find((o) => o.value === aiPlatform);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue={defaultTab || "general"}>
          <TabsList className="w-full">
            <TabsTrigger value="general" className="flex-1">General</TabsTrigger>
            {supabaseConfigured && (
              <TabsTrigger value="team" className="flex-1 gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Team
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="general">
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
                  Reminds you to update kanban cards on every message
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
          </TabsContent>

          {supabaseConfigured && (
            <TabsContent value="team">
              <div className="grid gap-4 py-4">
                {!currentUser ? (
                  /* Auth Form */
                  <div className="grid gap-4">
                    <div className="flex gap-2">
                      <Button
                        variant={authTab === "signin" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setAuthTab("signin")}
                        className="flex-1"
                      >
                        Sign In
                      </Button>
                      <Button
                        variant={authTab === "signup" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setAuthTab("signup")}
                        className="flex-1"
                      >
                        Sign Up
                      </Button>
                    </div>

                    {authTab === "signup" && (
                      <Input
                        placeholder="Display name"
                        value={authDisplayName}
                        onChange={(e) => setAuthDisplayName(e.target.value)}
                      />
                    )}
                    <Input
                      type="email"
                      placeholder="Email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                    />
                    <Input
                      type="password"
                      placeholder="Password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAuthSubmit()}
                    />

                    {authError && (
                      <p className="text-xs text-destructive">{authError}</p>
                    )}

                    <Button onClick={handleAuthSubmit} disabled={authLoading}>
                      {authLoading ? "Loading..." : authTab === "signup" ? "Create Account" : "Sign In"}
                    </Button>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-xs">
                        <span className="bg-background px-2 text-muted-foreground">or</span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1 gap-2"
                        onClick={() => signInOAuth("google")}
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                        Google
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1 gap-2"
                        onClick={() => signInOAuth("github")}
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                        </svg>
                        GitHub
                      </Button>
                    </div>
                  </div>
                ) : !currentUser.emailConfirmed ? (
                  /* Email not confirmed */
                  <div className="grid gap-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{currentUser.displayName}</p>
                        <p className="text-xs text-muted-foreground">{currentUser.email}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={async () => { await signOutUser(); }}
                        title="Sign out"
                      >
                        <LogOut className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="border-t border-border" />
                    <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-4 text-center space-y-2">
                      <p className="text-sm font-medium text-amber-500">Check your email</p>
                      <p className="text-xs text-muted-foreground">
                        We sent a confirmation link to <strong>{currentUser.email}</strong>. Click the link to activate your account.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        await signOutUser();
                        setAuthTab("signin");
                        setAuthEmail("");
                        setAuthPassword("");
                        setAuthDisplayName("");
                        toast.success("Email confirmed! Please sign in.");
                      }}
                    >
                      I confirmed my email
                    </Button>
                  </div>
                ) : (
                  /* Logged in - teams management */
                  <div className="grid gap-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{currentUser.displayName}</p>
                        <p className="text-xs text-muted-foreground">{currentUser.email}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={async () => { await signOutUser(); }}
                        title="Sign out"
                      >
                        <LogOut className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="border-t border-border" />

                    {/* Active team details */}
                    {activeTeam && (
                      <>
                        {/* Team selector if multiple teams */}
                        {teams.length > 1 && (
                          <div className="grid gap-2">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              Your Teams ({teams.length})
                            </label>
                            <div className="space-y-1">
                              {teams.map((t) => (
                                <button
                                  key={t.id}
                                  className={`w-full text-left text-sm px-3 py-1.5 rounded-md transition-colors ${
                                    t.id === resolvedTeamId
                                      ? "bg-primary/10 text-primary font-medium"
                                      : "text-muted-foreground hover:bg-muted"
                                  }`}
                                  onClick={() => setActiveTeam(t.id)}
                                >
                                  {t.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {isOwnerOrAdmin && (
                          <>
                            <div className="grid gap-2">
                              <label className="text-sm font-medium">{activeTeam.name}</label>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Invite code:</span>
                                <code className="text-xs font-mono bg-muted px-2 py-1 rounded">
                                  {activeTeam.inviteCode}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => {
                                    navigator.clipboard.writeText(activeTeam.inviteCode);
                                    toast.success("Invite code copied");
                                  }}
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => {
                                    const joinUrl = `${window.location.origin}?join=${activeTeam.inviteCode}`;
                                    const message = `Join my team "${activeTeam.name}" on Ideafy!\n\nInvite code: ${activeTeam.inviteCode}\n\nOr open this link:\n${joinUrl}`;
                                    if (navigator.share) {
                                      navigator.share({ title: `Join ${activeTeam.name} on Ideafy`, text: message, url: joinUrl });
                                    } else {
                                      navigator.clipboard.writeText(message);
                                      toast.success("Invite message copied to clipboard");
                                    }
                                  }}
                                >
                                  <Share2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>

                            <div className="grid gap-2">
                              <label className="text-sm font-medium flex items-center gap-1.5">
                                <Mail className="h-3.5 w-3.5" />
                                Invite by Email
                              </label>
                              <div className="flex gap-2">
                                <Input
                                  type="email"
                                  placeholder="colleague@example.com"
                                  value={inviteEmail}
                                  onChange={(e) => setInviteEmail(e.target.value)}
                                  onKeyDown={(e) => e.key === "Enter" && handleSendInvite()}
                                  className="flex-1"
                                />
                                <Button
                                  size="sm"
                                  onClick={handleSendInvite}
                                  disabled={inviteSending || !inviteEmail.trim()}
                                  className="gap-1.5"
                                >
                                  {inviteSending ? (
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Send className="h-3.5 w-3.5" />
                                  )}
                                  Send
                                </Button>
                              </div>
                            </div>
                          </>
                        )}

                        {!isOwnerOrAdmin && activeTeam && (
                          <div className="grid gap-2">
                            <label className="text-sm font-medium">{activeTeam.name}</label>
                          </div>
                        )}

                        <div className="grid gap-2">
                          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Members ({displayMembers.length})
                          </label>
                          <div className="space-y-1.5">
                            {displayMembers.map((m) => (
                              <div key={m.id} className="flex items-center justify-between text-sm">
                                <span>{m.displayName}</span>
                                {isOwner && m.role !== "owner" ? (
                                  <Select
                                    value={m.role}
                                    onValueChange={async (value) => {
                                      const newRole = value as "admin" | "member";
                                      const result = await updateMemberRole(m.userId, newRole);
                                      if (result.error) toast.error(result.error);
                                      else toast.success(`${m.displayName} is now ${newRole}`);
                                    }}
                                  >
                                    <SelectTrigger className="h-7 w-[100px] text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="z-[70]">
                                      <SelectItem value="admin">Admin</SelectItem>
                                      <SelectItem value="member">Member</SelectItem>
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <span className="text-xs text-muted-foreground capitalize">{m.role}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        <Button
                          variant="outline"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => handleLeaveTeam(activeTeam.id)}
                          disabled={teamLoading}
                        >
                          Leave Team
                        </Button>

                        <div className="border-t border-border" />
                      </>
                    )}

                    {/* Create / Join - always available */}
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Create Team</label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Team name"
                          value={teamName}
                          onChange={(e) => setTeamName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleCreateTeam()}
                          className="flex-1"
                        />
                        <Button onClick={handleCreateTeam} disabled={teamLoading || !teamName.trim()}>
                          Create
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Join Team</label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Invite code"
                          value={inviteCode}
                          onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                          onKeyDown={(e) => e.key === "Enter" && handleJoinTeam()}
                          className="flex-1 font-mono uppercase"
                          maxLength={6}
                        />
                        <Button onClick={handleJoinTeam} disabled={teamLoading || !inviteCode.trim()}>
                          Join
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          )}
        </Tabs>

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
