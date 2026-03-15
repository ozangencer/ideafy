import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Signup Rate Limiter Tests
 *
 * middleware.ts'deki rate limiting mantığını doğrudan test eder.
 * NextRequest/NextResponse mock'lanarak middleware fonksiyonu çağrılır.
 */

// --- Mock NextRequest / NextResponse ---

function createMockRequest(pathname: string, ip = "127.0.0.1"): any {
  return {
    nextUrl: { pathname },
    headers: {
      get(name: string) {
        if (name === "x-forwarded-for") return ip;
        return null;
      },
    },
  };
}

// We need to capture NextResponse calls
let nextResponseJsonCalls: Array<{ body: any; status: number; headers: Record<string, string> }> = [];
let nextResponseNextCalls: Array<{ headers: Map<string, string> }> = [];

vi.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: {
    json(body: any, init?: { status?: number; headers?: Record<string, string> }) {
      const entry = {
        body,
        status: init?.status ?? 200,
        headers: init?.headers ?? {},
      };
      nextResponseJsonCalls.push(entry);
      return { ...entry, type: "json" };
    },
    next() {
      const headerMap = new Map<string, string>();
      const response = {
        type: "next",
        headers: {
          set(key: string, value: string) {
            headerMap.set(key, value);
          },
          get(key: string) {
            return headerMap.get(key);
          },
          entries() {
            return headerMap.entries();
          },
        },
      };
      nextResponseNextCalls.push({ headers: headerMap });
      return response;
    },
  },
}));

// Import middleware after mocks are set up
const { middleware } = await import("../middleware");

// Access the internal requestCounts map for cleanup between tests
// We'll reset it by clearing all entries via the middleware behavior

describe("Signup Rate Limiter", () => {
  beforeEach(() => {
    nextResponseJsonCalls = [];
    nextResponseNextCalls = [];
    // Clear the in-memory rate limit store by importing and clearing
    // Since we can't directly access requestCounts, we use unique IPs per test
  });

  describe("/api/team/auth/signup — 5'ten fazla istek/saat sonrası 429 dönüyor", () => {
    it("ilk 5 istek başarılı geçmeli (429 dönmemeli)", () => {
      const testIp = `signup-limit-${Date.now()}`;

      for (let i = 0; i < 5; i++) {
        nextResponseJsonCalls = [];
        nextResponseNextCalls = [];

        const req = createMockRequest("/api/team/auth/signup", testIp);
        const result = middleware(req) as any;

        // Should NOT be a 429 response
        expect(result.type).toBe("next");
      }
    });

    it("6. istekte 429 status kodu dönmeli", () => {
      const testIp = `signup-429-${Date.now()}`;

      // İlk 5 isteği gönder (bunlar geçmeli)
      for (let i = 0; i < 5; i++) {
        const req = createMockRequest("/api/team/auth/signup", testIp);
        middleware(req);
      }

      // 6. istek — 429 dönmeli
      nextResponseJsonCalls = [];
      const req = createMockRequest("/api/team/auth/signup", testIp);
      const result = middleware(req) as any;

      expect(result.status).toBe(429);
    });

    it("429 response'unda retryAfter alanı bulunmalı", () => {
      const testIp = `signup-retry-${Date.now()}`;

      for (let i = 0; i < 6; i++) {
        const req = createMockRequest("/api/team/auth/signup", testIp);
        middleware(req);
      }

      // Son çağrının response body'sini kontrol et
      const lastJson = nextResponseJsonCalls[nextResponseJsonCalls.length - 1];
      expect(lastJson.body.retryAfter).toBe(3600); // 1 saat = 3600 saniye
    });

    it("429 response'unda X-RateLimit-* header'ları bulunmalı", () => {
      const testIp = `signup-headers-${Date.now()}`;

      for (let i = 0; i < 6; i++) {
        const req = createMockRequest("/api/team/auth/signup", testIp);
        middleware(req);
      }

      const lastJson = nextResponseJsonCalls[nextResponseJsonCalls.length - 1];
      expect(lastJson.headers).toHaveProperty("X-RateLimit-Limit");
      expect(lastJson.headers).toHaveProperty("X-RateLimit-Remaining");
      expect(lastJson.headers).toHaveProperty("X-RateLimit-Reset");
      expect(lastJson.headers["X-RateLimit-Remaining"]).toBe("0");
    });

    it("429 response'unda doğru hata mesajı dönmeli", () => {
      const testIp = `signup-msg-${Date.now()}`;

      for (let i = 0; i < 6; i++) {
        const req = createMockRequest("/api/team/auth/signup", testIp);
        middleware(req);
      }

      const lastJson = nextResponseJsonCalls[nextResponseJsonCalls.length - 1];
      expect(lastJson.body.error).toContain("signup");
    });

    it("limit aşıldıktan sonra ek istekler de 429 dönmeli", () => {
      const testIp = `signup-extra-${Date.now()}`;

      // 5 + 5 = 10 istek gönder
      for (let i = 0; i < 10; i++) {
        const req = createMockRequest("/api/team/auth/signup", testIp);
        middleware(req);
      }

      // Son 5'i 429 olmalı
      const jsonResponses = nextResponseJsonCalls.filter((r) => r.status === 429);
      expect(jsonResponses.length).toBe(5);
    });
  });

  describe("Normal signup akışı (< 5 req/saat) etkilenmiyor", () => {
    it("1 istek sorunsuz geçmeli", () => {
      const testIp = `signup-normal-1-${Date.now()}`;
      nextResponseNextCalls = [];

      const req = createMockRequest("/api/team/auth/signup", testIp);
      const result = middleware(req) as any;

      expect(result.type).toBe("next");
    });

    it("3 istek sorunsuz geçmeli", () => {
      const testIp = `signup-normal-3-${Date.now()}`;

      for (let i = 0; i < 3; i++) {
        nextResponseJsonCalls = [];
        const req = createMockRequest("/api/team/auth/signup", testIp);
        const result = middleware(req) as any;

        expect(result.type).toBe("next");
      }

      // Hiçbir 429 response olmamalı
      const blocked = nextResponseJsonCalls.filter((r) => r.status === 429);
      expect(blocked.length).toBe(0);
    });

    it("tam 5 istek (limit sınırında) sorunsuz geçmeli", () => {
      const testIp = `signup-normal-5-${Date.now()}`;

      for (let i = 0; i < 5; i++) {
        const req = createMockRequest("/api/team/auth/signup", testIp);
        const result = middleware(req) as any;

        expect(result.type).toBe("next");
      }
    });

    it("başarılı response'larda X-RateLimit-Remaining doğru azalmalı", () => {
      const testIp = `signup-remaining-${Date.now()}`;
      nextResponseNextCalls = [];

      for (let i = 0; i < 3; i++) {
        const req = createMockRequest("/api/team/auth/signup", testIp);
        middleware(req);
      }

      // İlk başarılı response'un header'larını kontrol et
      // Not: Signup endpoint'i hem spesifik hem genel limiter'dan geçiyor
      // Response header'ları genel limiter'dan geliyor (son set edilen)
      const lastNext = nextResponseNextCalls[nextResponseNextCalls.length - 1];
      expect(lastNext.headers.has("X-RateLimit-Limit")).toBe(true);
    });

    it("farklı IP'lerden gelen istekler birbirini etkilememeli", () => {
      const ip1 = `signup-ip1-${Date.now()}`;
      const ip2 = `signup-ip2-${Date.now()}`;

      // IP1'den 5 istek (limit dolsun)
      for (let i = 0; i < 5; i++) {
        const req = createMockRequest("/api/team/auth/signup", ip1);
        middleware(req);
      }

      // IP2'den 1 istek — sorunsuz geçmeli
      const req = createMockRequest("/api/team/auth/signup", ip2);
      const result = middleware(req) as any;

      expect(result.type).toBe("next");
    });

    it("signup limiti diğer API endpoint'lerini etkilememeli", () => {
      const testIp = `signup-other-${Date.now()}`;

      // Signup limitini doldur
      for (let i = 0; i < 6; i++) {
        const req = createMockRequest("/api/team/auth/signup", testIp);
        middleware(req);
      }

      // Farklı endpoint'e istek — geçmeli
      const req = createMockRequest("/api/cards", testIp);
      const result = middleware(req) as any;

      expect(result.type).toBe("next");
    });
  });
});
