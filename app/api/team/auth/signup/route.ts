import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendConfirmationEmail } from "@/lib/team/email";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Server not configured" }, { status: 503 });
  }

  const body = await request.json();
  const { email, password, displayName } = body;

  if (!email || !password || !displayName) {
    return NextResponse.json({ error: "Email, password, and display name are required" }, { status: 400 });
  }

  // Create user with admin API (email_confirm: false so we control the flow)
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { display_name: displayName },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data.user) {
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }

  // Generate confirmation link
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "signup",
    email,
    password,
  });

  if (linkError || !linkData) {
    return NextResponse.json({ error: "User created but failed to generate confirmation link" }, { status: 500 });
  }

  // Extract the confirmation URL
  const confirmationUrl = linkData.properties?.action_link;
  if (!confirmationUrl) {
    return NextResponse.json({ error: "Failed to get confirmation URL" }, { status: 500 });
  }

  // Send email via Resend
  const emailResult = await sendConfirmationEmail(email, displayName, confirmationUrl);
  if (!emailResult.success) {
    console.error("Failed to send confirmation email:", emailResult.error);
    // User is still created, just email failed
  }

  return NextResponse.json({
    success: true,
    emailSent: emailResult.success,
    user: {
      id: data.user.id,
      email: data.user.email,
      displayName,
    },
  }, { status: 201 });
}
