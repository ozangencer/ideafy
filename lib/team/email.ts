import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.EMAIL_FROM || "Ideafy <onboarding@resend.dev>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3030";

function baseTemplate(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px">
    <!-- Logo -->
    <div style="text-align:center;margin-bottom:28px">
      <span style="font-size:22px;font-weight:700;color:#0d0d0d;letter-spacing:-0.5px">ideafy</span>
    </div>

    <!-- Card -->
    <div style="background:#ffffff;border-radius:12px;border:1px solid #e5e5e5;overflow:hidden">
      <!-- Accent strip -->
      <div style="height:3px;background:#f0a030"></div>
      <div style="padding:36px 32px">
        ${content}
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;margin-top:28px">
      <p style="font-size:12px;color:#999999;margin:0">Ideafy - AI-native development workflow</p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendConfirmationEmail(
  email: string,
  displayName: string,
  confirmationUrl: string
): Promise<{ success: boolean; error?: string }> {
  const content = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 8px;color:#0d0d0d">Welcome to Ideafy</h1>
    <p style="font-size:14px;line-height:1.6;color:#555555;margin:0 0 24px">
      Hi ${displayName}, thanks for signing up. Confirm your email address to get started.
    </p>
    <div style="text-align:center;margin:28px 0">
      <a href="${confirmationUrl}" style="display:inline-block;background:#f0a030;color:#0d0d0d;font-size:14px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.2px">
        Confirm Email
      </a>
    </div>
    <p style="font-size:12px;line-height:1.5;color:#999999;margin:24px 0 0">
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="font-size:11px;line-height:1.5;color:#c08020;word-break:break-all;margin:8px 0 0">${confirmationUrl}</p>
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: "Confirm your Ideafy account",
      html: baseTemplate(content),
    });

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    console.error("Failed to send confirmation email:", err);
    return { success: false, error: "Failed to send email" };
  }
}

export async function sendTeamInviteEmail(
  email: string,
  teamName: string,
  inviterName: string,
  inviteCode: string
): Promise<{ success: boolean; error?: string }> {
  const content = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 8px;color:#0d0d0d">You're invited to a team</h1>
    <p style="font-size:14px;line-height:1.6;color:#555555;margin:0 0 24px">
      ${inviterName} invited you to join <strong style="color:#0d0d0d">${teamName}</strong> on Ideafy.
    </p>
    <div style="text-align:center;margin:28px 0;padding:20px;background:#faf5ee;border-radius:8px;border:1px solid #e5e5e5">
      <p style="font-size:12px;color:#999999;margin:0 0 8px">Your invite code</p>
      <p style="font-size:28px;font-weight:700;font-family:monospace;color:#c08020;margin:0;letter-spacing:4px">${inviteCode}</p>
    </div>
    <p style="font-size:14px;line-height:1.6;color:#555555;margin:0 0 24px">
      Open Ideafy, go to Settings, select the Team tab, and enter this code to join.
    </p>
    <div style="text-align:center">
      <a href="${APP_URL}" style="display:inline-block;background:#f0a030;color:#0d0d0d;font-size:14px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.2px">
        Open Ideafy
      </a>
    </div>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `${inviterName} invited you to ${teamName}`,
      html: baseTemplate(content),
    });

    if (error) {
      console.error("Resend invite error:", error);
      return { success: false, error: error.message };
    }
    console.log("Resend invite sent:", data);
    return { success: true };
  } catch (err) {
    console.error("Failed to send invite email:", err);
    return { success: false, error: "Failed to send email" };
  }
}
