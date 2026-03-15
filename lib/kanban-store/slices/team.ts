import type { TeamUser, Team, TeamMember, PoolCard } from "../../team/types";
import { isSupabaseConfigured } from "../../team/supabase";
import {
  getCurrentUser,
  onAuthStateChange,
  signUpWithEmail,
  signInWithEmail,
  signInWithOAuth,
  signOut as authSignOut,
} from "../../team/auth";
import { KanbanStore, StoreSlice } from "../types";

const ACTIVE_TEAM_KEY = "ideafy-active-team-id";

// Helper to get auth header from Supabase session
async function getAuthHeader(): Promise<string | null> {
  // Dynamic import to avoid SSR issues
  const { getSupabaseClient } = await import("../../team/supabase");
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  return `Bearer ${session.access_token}`;
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const authHeader = await getAuthHeader();
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  });
}

export const createTeamSlice: StoreSlice<
  Pick<
    KanbanStore,
    | "teamMode"
    | "supabaseConfigured"
    | "currentUser"
    | "teams"
    | "activeTeamId"
    | "teamMembers"
    | "poolCards"
    | "isTeamLoading"
    | "initTeam"
    | "signUp"
    | "signIn"
    | "signInOAuth"
    | "signOutUser"
    | "createTeam"
    | "joinTeam"
    | "leaveTeam"
    | "setActiveTeam"
    | "fetchTeam"
    | "fetchTeamMembers"
    | "fetchMembersForTeam"
    | "teamMembersByTeamId"
    | "fetchPoolCards"
    | "sendToPool"
    | "pullFromPool"
    | "pushUpdate"
    | "removeFromPool"
    | "claimPoolCard"
    | "updateMemberRole"
  >
> = (set, get) => ({
  teamMode: false,
  supabaseConfigured: isSupabaseConfigured(),
  currentUser: null,
  teams: [],
  activeTeamId: null,
  teamMembers: [],
  teamMembersByTeamId: {},
  poolCards: [],
  isTeamLoading: false,

  initTeam: async () => {
    if (!isSupabaseConfigured()) return;

    set({ isTeamLoading: true });
    try {
      const user = await getCurrentUser();
      set({ currentUser: user });

      if (user) {
        set({ teamMode: true });
        await get().fetchTeam();
        // fetchTeam sets activeTeamId which triggers members/pool fetch
        await get().fetchTeamMembers();
        await get().fetchPoolCards();
      }

      // Listen for auth changes
      onAuthStateChange((user) => {
        set({ currentUser: user });
        if (user) {
          set({ teamMode: true });
          get().fetchTeam().then(() => {
            get().fetchTeamMembers();
            get().fetchPoolCards();
          });
        } else {
          set({
            teamMode: false,
            teams: [],
            activeTeamId: null,
            teamMembers: [],
            teamMembersByTeamId: {},
            poolCards: [],
          });
        }
      });
    } catch (error) {
      console.error("Failed to init team:", error);
    } finally {
      set({ isTeamLoading: false });
    }
  },

  setActiveTeam: (teamId: string | null) => {
    set({ activeTeamId: teamId });
    if (teamId) {
      try { localStorage.setItem(ACTIVE_TEAM_KEY, teamId); } catch {}
    } else {
      try { localStorage.removeItem(ACTIVE_TEAM_KEY); } catch {}
    }
    // Refresh members and pool for the new active team
    get().fetchTeamMembers();
    get().fetchPoolCards();
  },

  signUp: async (email: string, password: string, displayName: string) => {
    const result = await signUpWithEmail(email, password, displayName);
    if (result.user) {
      set({ currentUser: result.user, teamMode: true });
    }
    return result;
  },

  signIn: async (email: string, password: string) => {
    const result = await signInWithEmail(email, password);
    if (result.user) {
      set({ currentUser: result.user, teamMode: true });
      await get().fetchTeam();
      await get().fetchTeamMembers();
      await get().fetchPoolCards();
    }
    return result;
  },

  signInOAuth: async (provider: "google" | "github") => {
    const result = await signInWithOAuth(provider);
    if (result.error) return result;

    const isElectron = typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");
    if (isElectron && result.url) {
      // Open OAuth URL in system browser
      window.open(result.url, "_blank");

      // Poll for token relay from browser callback
      const poll = async (): Promise<void> => {
        for (let i = 0; i < 120; i++) {
          await new Promise(r => setTimeout(r, 1000));
          try {
            const res = await fetch("/api/team/auth/token-relay");
            const data = await res.json();
            if (data.token) {
              const { getSupabaseClient } = await import("@/lib/team/supabase");
              const supabase = getSupabaseClient();
              if (supabase) {
                await supabase.auth.setSession(data.token);
                const teamUser = await (await import("@/lib/team/auth")).getCurrentUser();
                if (teamUser) {
                  set({ currentUser: teamUser, teamMode: true });
                  await get().fetchTeam();
                  await get().fetchTeamMembers();
                  await get().fetchPoolCards();
                }
              }
              return;
            }
          } catch { /* continue polling */ }
        }
      };
      poll();
    }
    return result;
  },

  signOutUser: async () => {
    const result = await authSignOut();
    if (!result.error) {
      set({
        currentUser: null,
        teams: [],
        activeTeamId: null,
        teamMembers: [],
        teamMembersByTeamId: {},
        poolCards: [],
        teamMode: false,
      });
    }
    return result;
  },

  fetchTeam: async () => {
    try {
      const response = await fetchWithAuth("/api/team");
      const data = await response.json();
      const teams: Team[] = data.teams || [];
      set({ teams });

      // Resolve activeTeamId
      const currentActiveId = get().activeTeamId;
      let savedId: string | null = null;
      try { savedId = localStorage.getItem(ACTIVE_TEAM_KEY); } catch {}

      const teamIds = teams.map((t) => t.id);

      if (currentActiveId && (currentActiveId === "all" || teamIds.includes(currentActiveId))) {
        // Current active is still valid
      } else if (savedId && (savedId === "all" || teamIds.includes(savedId))) {
        set({ activeTeamId: savedId });
      } else if (teams.length > 0) {
        set({ activeTeamId: "all" });
        try { localStorage.setItem(ACTIVE_TEAM_KEY, "all"); } catch {}
      } else {
        set({ activeTeamId: null });
      }
    } catch (error) {
      console.error("Failed to fetch team:", error);
    }
  },

  createTeam: async (name: string) => {
    try {
      const response = await fetchWithAuth("/api/team", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (data.error) return { error: data.error };

      const newTeam: Team = data.team;
      const currentTeams = get().teams;
      set({ teams: [...currentTeams, newTeam], activeTeamId: newTeam.id });
      try { localStorage.setItem(ACTIVE_TEAM_KEY, newTeam.id); } catch {}
      await get().fetchTeamMembers();
      return { error: null };
    } catch (error) {
      return { error: "Failed to create team" };
    }
  },

  joinTeam: async (inviteCode: string) => {
    try {
      const response = await fetchWithAuth("/api/team/join", {
        method: "POST",
        body: JSON.stringify({ inviteCode }),
      });
      const data = await response.json();
      if (data.error) return { error: data.error };

      const newTeam: Team = data.team;
      const currentTeams = get().teams;
      // Avoid duplicates (in case of race)
      const exists = currentTeams.some((t) => t.id === newTeam.id);
      const updatedTeams = exists ? currentTeams : [...currentTeams, newTeam];
      set({ teams: updatedTeams, activeTeamId: newTeam.id });
      try { localStorage.setItem(ACTIVE_TEAM_KEY, newTeam.id); } catch {}
      await get().fetchTeamMembers();
      await get().fetchPoolCards();
      return { error: null };
    } catch (error) {
      return { error: "Failed to join team" };
    }
  },

  leaveTeam: async (teamId: string) => {
    try {
      await fetchWithAuth("/api/team/members", {
        method: "DELETE",
        body: JSON.stringify({ teamId }),
      });
      const currentTeams = get().teams.filter((t) => t.id !== teamId);
      const wasActive = get().activeTeamId === teamId;
      const newActiveId = wasActive ? (currentTeams.length > 0 ? "all" : null) : get().activeTeamId;

      set({ teams: currentTeams, activeTeamId: newActiveId });
      if (newActiveId) {
        try { localStorage.setItem(ACTIVE_TEAM_KEY, newActiveId); } catch {}
      } else {
        try { localStorage.removeItem(ACTIVE_TEAM_KEY); } catch {}
        set({ teamMembers: [], poolCards: [] });
      }

      if (wasActive && newActiveId) {
        await get().fetchTeamMembers();
        await get().fetchPoolCards();
      }

      return { error: null };
    } catch (error) {
      return { error: "Failed to leave team" };
    }
  },

  fetchTeamMembers: async () => {
    const activeTeamId = get().activeTeamId;
    if (!activeTeamId || activeTeamId === "all") {
      set({ teamMembers: [] });
      return;
    }
    try {
      const response = await fetchWithAuth(`/api/team/members?teamId=${activeTeamId}`);
      const data = await response.json();
      const members = data.members || [];
      set({
        teamMembers: members,
        teamMembersByTeamId: { ...get().teamMembersByTeamId, [activeTeamId]: members },
      });
    } catch (error) {
      console.error("Failed to fetch team members:", error);
    }
  },

  fetchMembersForTeam: async (teamId: string) => {
    // Return from cache if available (check key existence, not truthiness — [] is truthy)
    const cache = get().teamMembersByTeamId;
    if (teamId in cache && cache[teamId].length > 0) return cache[teamId];

    try {
      const response = await fetchWithAuth(`/api/team/members?teamId=${teamId}`);
      if (!response.ok) {
        console.error("Failed to fetch members for team:", response.status);
        return [];
      }
      const data = await response.json();
      const members: TeamMember[] = data.members || [];
      set({
        teamMembersByTeamId: { ...get().teamMembersByTeamId, [teamId]: members },
      });
      return members;
    } catch (error) {
      console.error("Failed to fetch members for team:", error);
      return [];
    }
  },

  fetchPoolCards: async (teamId?: string) => {
    const resolvedTeamId = teamId || get().activeTeamId;
    if (!resolvedTeamId) {
      set({ poolCards: [] });
      return;
    }
    try {
      const response = await fetchWithAuth(`/api/team/pool?teamId=${resolvedTeamId}`);
      const data = await response.json();
      const fetchedPoolCards = data.cards || [];
      set({ poolCards: fetchedPoolCards });

      // Clean up orphaned poolCardIds on local cards
      // Only check cards whose project belongs to the fetched team scope
      const poolCardIds = new Set(fetchedPoolCards.map((pc: { id: string }) => pc.id));
      const projects = get().projects;
      const orphanedCards = get().cards.filter((c) => {
        if (!c.poolCardId || poolCardIds.has(c.poolCardId)) return false;
        if (resolvedTeamId === "all") return true;
        // Only clean up if the card's project belongs to the fetched team
        const proj = projects.find((p) => p.id === c.projectId);
        return proj?.teamId === resolvedTeamId;
      });
      for (const card of orphanedCards) {
        await get().updateCard(card.id, { poolCardId: null } as never);
      }
    } catch (error) {
      console.error("Failed to fetch pool cards:", error);
    }
  },

  sendToPool: async (cardId: string, assignedTo?: string) => {
    const card = get().cards.find((c) => c.id === cardId);
    if (!card) return { error: "Card not found" };

    // Use the card's project teamId first, fallback to activeTeamId (but not "all")
    const project = get().projects.find((p) => p.id === card.projectId);
    const currentActiveTeam = get().activeTeamId;
    const teamId = project?.teamId || (currentActiveTeam && currentActiveTeam !== "all" ? currentActiveTeam : null);
    if (!teamId) return { error: "No team linked to project or active" };

    try {
      const response = await fetchWithAuth("/api/team/pool", {
        method: "POST",
        body: JSON.stringify({
          teamId,
          cardData: {
            title: card.title,
            description: card.description,
            solutionSummary: card.solutionSummary,
            testScenarios: card.testScenarios,
            aiOpinion: card.aiOpinion,
            aiVerdict: card.aiVerdict,
            status: card.status,
            complexity: card.complexity,
            priority: card.priority,
            projectName: project?.name || undefined,
            sourceCardId: card.id,
          },
          assignedTo: assignedTo || card.assignedTo || undefined,
        }),
      });

      const data = await response.json();
      if (data.error) return { error: data.error };

      // Update local card with pool link
      await get().updateCard(cardId, { poolCardId: data.poolCardId, poolOrigin: "pushed" } as never);
      await get().fetchPoolCards();
      return { error: null, poolCardId: data.poolCardId };
    } catch (error) {
      return { error: "Failed to send to pool" };
    }
  },

  pullFromPool: async (poolCardId: string) => {
    try {
      const response = await fetchWithAuth("/api/team/pool/pull", {
        method: "POST",
        body: JSON.stringify({ poolCardId }),
      });
      const data = await response.json();
      if (data.error) return { error: data.error };

      // Refresh local cards and pool cards
      await get().fetchCards();
      await get().fetchPoolCards();
      return { error: null, cardId: data.cardId };
    } catch (error) {
      return { error: "Failed to pull from pool" };
    }
  },

  pushUpdate: async (cardId: string) => {
    try {
      const response = await fetchWithAuth("/api/team/pool/push", {
        method: "POST",
        body: JSON.stringify({ cardId }),
      });
      const data = await response.json();
      if (data.error) return { error: data.error };

      await get().fetchPoolCards();
      return { error: null };
    } catch (error) {
      return { error: "Failed to push update" };
    }
  },

  removeFromPool: async (poolCardId: string, localCardId?: string) => {
    try {
      const response = await fetchWithAuth("/api/team/pool", {
        method: "DELETE",
        body: JSON.stringify({ poolCardId }),
      });
      const data = await response.json();
      if (data.error) return { error: data.error };

      // Clear pool link on local card if provided
      if (localCardId) {
        await get().updateCard(localCardId, { poolCardId: null } as never);
      }

      await get().fetchPoolCards();
      return { error: null };
    } catch (error) {
      return { error: "Failed to remove from pool" };
    }
  },

  claimPoolCard: async (poolCardId: string, action: "claim" | "unclaim" = "claim") => {
    try {
      const response = await fetchWithAuth("/api/team/pool", {
        method: "PATCH",
        body: JSON.stringify({ poolCardId, action }),
      });
      const data = await response.json();
      if (data.error) return { error: data.error };

      // Optimistic: update the poolCard in-place instead of refetching
      const currentUser = get().currentUser;
      set({
        poolCards: get().poolCards.map((c) =>
          c.id === poolCardId
            ? {
                ...c,
                assignedTo: action === "claim" ? currentUser?.id : undefined,
                assignedToName: action === "claim" ? currentUser?.displayName : undefined,
              }
            : c
        ),
      });

      return { error: null };
    } catch (error) {
      return { error: "Failed to update assignment" };
    }
  },

  updateMemberRole: async (targetUserId: string, newRole: "admin" | "member") => {
    const activeTeamId = get().activeTeamId;
    if (!activeTeamId || activeTeamId === "all") return { error: "No active team" };

    // Optimistic update
    const previousMembers = get().teamMembers;
    set({
      teamMembers: previousMembers.map(m =>
        m.userId === targetUserId ? { ...m, role: newRole } : m
      ),
    });

    try {
      const response = await fetchWithAuth("/api/team/members", {
        method: "PATCH",
        body: JSON.stringify({ teamId: activeTeamId, targetUserId, newRole }),
      });
      const data = await response.json();
      if (data.error) {
        // Rollback on error
        set({ teamMembers: previousMembers });
        return { error: data.error };
      }

      return { error: null };
    } catch {
      set({ teamMembers: previousMembers });
      return { error: "Failed to update member role" };
    }
  },
});
