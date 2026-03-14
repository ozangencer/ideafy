// Client-side helper for sending assignment notifications

async function getAuthHeader(): Promise<string | null> {
  try {
    const { getSupabaseClient } = await import("./supabase");
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? `Bearer ${session.access_token}` : null;
  } catch {
    return null;
  }
}

export async function sendAssignmentNotification({
  recipientUserId,
  teamId,
  cardTitle,
  referenceId,
}: {
  recipientUserId: string;
  teamId: string;
  cardTitle: string;
  referenceId?: string;
}) {
  try {
    const authHeader = await getAuthHeader();
    if (!authHeader) return;

    await fetch("/api/team/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        recipientUserId,
        teamId,
        type: "assignment",
        title: "You have been assigned a card",
        message: cardTitle,
        referenceId,
      }),
    });
  } catch {
    // Silently fail - notification is best-effort
  }
}
