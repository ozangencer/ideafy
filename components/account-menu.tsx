"use client";

import { useState } from "react";
import { Settings, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { useKanbanStore } from "@/lib/store";
import { SettingsModal } from "@/components/sidebar/settings-modal";

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function AccountMenu() {
  const { teamMode, currentUser, teams, activeTeamId, setActiveTeam, signOutUser, supabaseConfigured } =
    useKanbanStore();
  const [showTeamSettings, setShowTeamSettings] = useState(false);

  if (!supabaseConfigured) return null;

  if (!teamMode || !currentUser) {
    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setShowTeamSettings(true)}
        >
          <LogIn className="h-4 w-4" />
          <span className="sr-only">Sign In</span>
        </Button>
        {showTeamSettings && (
          <SettingsModal onClose={() => setShowTeamSettings(false)} defaultTab="team" />
        )}
      </>
    );
  }

  const initials = getInitials(currentUser.displayName || currentUser.email);
  const activeTeam = teams.find((t) => t.id === activeTeamId);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
              {initials}
            </span>
            <span className="sr-only">Account menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {/* User info */}
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{currentUser.displayName}</p>
              <p className="text-xs leading-none text-muted-foreground">{currentUser.email}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {/* Team switcher */}
          {teams.length <= 1 ? (
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {activeTeam?.name || "No team"}
            </DropdownMenuLabel>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {activeTeam?.name || "Select team"}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={activeTeamId || ""}
                  onValueChange={(value) => setActiveTeam(value)}
                >
                  {teams.map((team) => (
                    <DropdownMenuRadioItem key={team.id} value={team.id}>
                      {team.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />

          {/* Team Settings */}
          <DropdownMenuItem onClick={() => setShowTeamSettings(true)}>
            <Settings className="mr-2 h-4 w-4" />
            Team Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          {/* Sign Out */}
          <DropdownMenuItem onClick={() => signOutUser()}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {showTeamSettings && (
        <SettingsModal onClose={() => setShowTeamSettings(false)} defaultTab="team" />
      )}
    </>
  );
}
