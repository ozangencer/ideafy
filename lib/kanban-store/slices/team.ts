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
    | "currentTeam"
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
    | "fetchTeam"
    | "fetchTeamMembers"
    | "fetchPoolCards"
    | "sendToPool"
    | "pullFromPool"
    | "pushUpdate"
    | "removeFromPool"
  >
> = (set, get) => ({
  teamMode: false,
  supabaseConfigured: isSupabaseConfigured(),
  currentUser: null,
  currentTeam: null,
  teamMembers: [],
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
        // Fetch team data
        await get().fetchTeam();
        await get().fetchTeamMembers();
        await get().fetchPoolCards();
      }

      // Listen for auth changes
      onAuthStateChange((user) => {
        set({ currentUser: user });
        if (user) {
          set({ teamMode: true });
          get().fetchTeam();
          get().fetchTeamMembers();
          get().fetchPoolCards();
        } else {
          set({
            teamMode: false,
            currentTeam: null,
            teamMembers: [],
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
        currentTeam: null,
        teamMembers: [],
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
      set({ currentTeam: data.team || null });
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
      set({ currentTeam: data.team });
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
      set({ currentTeam: data.team });
      await get().fetchTeamMembers();
      await get().fetchPoolCards();
      return { error: null };
    } catch (error) {
      return { error: "Failed to join team" };
    }
  },

  leaveTeam: async () => {
    try {
      await fetchWithAuth("/api/team/members", { method: "DELETE" });
      set({ currentTeam: null, teamMembers: [], poolCards: [] });
      return { error: null };
    } catch (error) {
      return { error: "Failed to leave team" };
    }
  },

  fetchTeamMembers: async () => {
    try {
      const response = await fetchWithAuth("/api/team/members");
      const data = await response.json();
      set({ teamMembers: data.members || [] });
    } catch (error) {
      console.error("Failed to fetch team members:", error);
    }
  },

  fetchPoolCards: async () => {
    try {
      const response = await fetchWithAuth("/api/team/pool");
      const data = await response.json();
      set({ poolCards: data.cards || [] });
    } catch (error) {
      console.error("Failed to fetch pool cards:", error);
    }
  },

  sendToPool: async (cardId: string, assignedTo?: string) => {
    const card = get().cards.find((c) => c.id === cardId);
    if (!card) return { error: "Card not found" };

    try {
      const response = await fetchWithAuth("/api/team/pool", {
        method: "POST",
        body: JSON.stringify({
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
            sourceCardId: card.id,
          },
          assignedTo,
        }),
      });

      const data = await response.json();
      if (data.error) return { error: data.error };

      // Update local card with pool link
      await get().updateCard(cardId, { poolCardId: data.poolCardId } as never);
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
});
