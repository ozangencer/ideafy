import { NextRequest, NextResponse } from "next/server";

/**
 * In-memory rate limiting store
 * Key: "ip:path-prefix" → { count, resetTime }
 * Note: Resets on server restart. For multi-instance, use Redis.
 */
const requestCounts = new Map<string, { count: number; resetTime: number }>();

// Cleanup old entries every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    Array.from(requestCounts.entries()).forEach(([key, data]) => {
      if (now > data.resetTime + 60000) {
        requestCounts.delete(key);
      }
    });
  }, 300000);
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  message: string;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Sensitive auth endpoints — stricter limits
  "/api/team/auth/signup": {
    maxRequests: 5,
    windowMs: 3600000, // 1 hour
    message: "Too many signup attempts. Please try again in an hour.",
  },
  "/api/team/auth/token-relay": {
    maxRequests: 10,
    windowMs: 900000, // 15 minutes
    message: "Too many auth attempts. Please try again in 15 minutes.",
  },
  // General API — broad limit
  "/api": {
    maxRequests: 100,
    windowMs: 60000, // 1 minute
    message: "Too many requests. Please slow down.",
  },
};

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkRateLimit(ip: string, key: string, config: RateLimitConfig): { limited: boolean; headers: Record<string, string> } {
  const now = Date.now();
  const storeKey = `${ip}:${key}`;

  let data = requestCounts.get(storeKey);

  if (!data || now > data.resetTime) {
    data = { count: 0, resetTime: now + config.windowMs };
    requestCounts.set(storeKey, data);
  }

  data.count++;

  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(config.maxRequests),
    "X-RateLimit-Remaining": String(Math.max(0, config.maxRequests - data.count)),
    "X-RateLimit-Reset": new Date(data.resetTime).toISOString(),
  };

  return {
    limited: data.count > config.maxRequests,
    headers,
  };
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only rate limit API routes
  if (!pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  const ip = getClientIp(request);

  // Check specific limits first (most specific match wins)
  const specificLimits = Object.entries(RATE_LIMITS).filter(([p]) => p !== "/api");
  for (let i = 0; i < specificLimits.length; i++) {
    const [prefix, config] = specificLimits[i];
    if (pathname.startsWith(prefix)) {
      const { limited, headers } = checkRateLimit(ip, prefix, config);
      if (limited) {
        return NextResponse.json(
          {
            error: config.message,
            retryAfter: Math.ceil(config.windowMs / 1000),
          },
          { status: 429, headers }
        );
      }
      // Don't return — also apply general API limit below
      break;
    }
  }

  // General API rate limit
  const generalConfig = RATE_LIMITS["/api"];
  const { limited, headers } = checkRateLimit(ip, "/api", generalConfig);

  if (limited) {
    return NextResponse.json(
      {
        error: generalConfig.message,
        retryAfter: Math.ceil(generalConfig.windowMs / 1000),
      },
      { status: 429, headers }
    );
  }

  // Add rate limit headers to successful responses
  const response = NextResponse.next();
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
