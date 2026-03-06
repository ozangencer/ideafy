import { NextRequest, NextResponse } from "next/server";

// Temporary in-memory store for OAuth token relay (Electron <-> Browser)
let pendingToken: { access_token: string; refresh_token: string } | null = null;
let tokenTimestamp = 0;

// Browser posts token after OAuth callback
export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.access_token || !body.refresh_token) {
    return NextResponse.json({ error: "Missing tokens" }, { status: 400 });
  }
  pendingToken = { access_token: body.access_token, refresh_token: body.refresh_token };
  tokenTimestamp = Date.now();
  return NextResponse.json({ success: true });
}

// Electron polls for token
export async function GET() {
  // Expire after 60 seconds
  if (pendingToken && Date.now() - tokenTimestamp < 60_000) {
    const token = pendingToken;
    pendingToken = null;
    return NextResponse.json({ token });
  }
  return NextResponse.json({ token: null });
}
