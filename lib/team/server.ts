import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

// Server-side Supabase client with service role for RLS bypass on verified requests
export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Verify JWT and return user
export async function getAuthenticatedUser(
  authHeader: string | null
): Promise<{ user: User | null; error: string | null }> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { user: null, error: "Missing auth token" };
  }

  const token = authHeader.replace("Bearer ", "");
  const supabase = getSupabaseAdmin();
  if (!supabase) return { user: null, error: "Supabase not configured" };

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { user: null, error: error?.message || "Invalid token" };
  }

  return { user, error: null };
}
