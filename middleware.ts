import { NextRequest, NextResponse } from "next/server";

// Ideafy is a local-only desktop app. This middleware blocks two classes of
// attack that would otherwise yield full RCE as the user:
//
//   1. DNS rebinding — an attacker-controlled domain resolves to 127.0.0.1
//      after TTL expiry. Browser sends the request with Host: evil.com.
//      We reject any Host that isn't an explicit loopback literal.
//
//   2. Cross-site request forgery — a page the user visits on another origin
//      issues fetch() to 127.0.0.1:PORT. Browser attaches Origin: http://evil.com.
//      We reject mutating requests whose Origin (or Referer, as fallback)
//      isn't the loopback origin.
//
// Non-browser callers (curl from the Claude Code hook, the MCP server, tests)
// have no Origin/Referer headers; the Host check alone protects them.

const PORT = process.env.PORT || "3030";

const ALLOWED_HOSTS = new Set([
  `localhost:${PORT}`,
  `127.0.0.1:${PORT}`,
  `[::1]:${PORT}`,
]);

const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  `http://[::1]:${PORT}`,
]);

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function forbid(reason: string): NextResponse {
  return new NextResponse(JSON.stringify({ error: "Forbidden", reason }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

export function middleware(request: NextRequest): NextResponse {
  const host = request.headers.get("host") ?? "";
  if (!ALLOWED_HOSTS.has(host)) {
    return forbid("host-not-loopback");
  }

  if (!MUTATING_METHODS.has(request.method)) {
    return NextResponse.next();
  }

  const origin = request.headers.get("origin");
  if (origin) {
    if (!ALLOWED_ORIGINS.has(origin)) {
      return forbid("origin-not-loopback");
    }
    return NextResponse.next();
  }

  const referer = request.headers.get("referer");
  if (referer) {
    let refererOrigin: string;
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      return forbid("referer-invalid");
    }
    if (!ALLOWED_ORIGINS.has(refererOrigin)) {
      return forbid("referer-not-loopback");
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
