import { getSupabaseClient } from "./supabase";
import type { TeamUser } from "./types";

function mapUser(user: { id: string; email?: string | null; email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> }, fallbackEmail?: string): TeamUser {
  return {
    id: user.id,
    email: user.email || fallbackEmail || "",
    displayName:
      (user.user_metadata?.display_name as string) ||
      (user.user_metadata?.full_name as string) ||
      user.email?.split("@")[0] ||
      "User",
    avatarUrl: user.user_metadata?.avatar_url as string | undefined,
    emailConfirmed: !!user.email_confirmed_at,
  };
}

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string
): Promise<{ user: TeamUser | null; error: string | null }> {
  try {
    // Use our server-side API that sends confirmation via Resend
    const response = await fetch("/api/team/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, displayName }),
    });

    const data = await response.json();
    if (data.error) return { user: null, error: data.error };

    return {
      user: {
        id: data.user.id,
        email: data.user.email || email,
        displayName,
        emailConfirmed: false,
      },
      error: null,
    };
  } catch {
    return { user: null, error: "Failed to sign up" };
  }
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<{ user: TeamUser | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { user: null, error: "Supabase not configured" };

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) return { user: null, error: error.message };
  if (!data.user) return { user: null, error: "Sign in failed" };

  return { user: mapUser(data.user, email), error: null };
}

export async function signInWithOAuth(
  provider: "google" | "github"
): Promise<{ error: string | null; url?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { error: "Supabase not configured" };

  const isElectron = navigator.userAgent.includes("Electron");

  if (isElectron) {
    // Use skipBrowserRedirect to get the URL, then open in system browser
    // The hash fragment will contain tokens directly (implicit flow)
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        skipBrowserRedirect: true,
      },
    });
    if (error) return { error: error.message };
    return { error: null, url: data.url };
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });

  return { error: error?.message || null };
}

export async function signOut(): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { error: "Supabase not configured" };

  const { error } = await supabase.auth.signOut();
  return { error: error?.message || null };
}

export async function getCurrentUser(): Promise<TeamUser | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  return mapUser(user);
}

export function onAuthStateChange(
  callback: (user: TeamUser | null) => void
): (() => void) | undefined {
  const supabase = getSupabaseClient();
  if (!supabase) return undefined;

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      callback(mapUser(session.user));
    } else {
      callback(null);
    }
  });

  return () => subscription.unsubscribe();
}
