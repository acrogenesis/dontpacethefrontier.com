import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

async function fetchWorker(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(`http://localhost${path}`, init);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("Worker security integration", () => {
  it("health is minimal", async () => {
    const res = await fetchWorker("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true });
    expect(body.mockAuth).toBeUndefined();
    expect(body.hasXClientId).toBeUndefined();
  });

  it("rejects mock OAuth callback when mock mode is off", async () => {
    const res = await fetchWorker(
      "/api/auth/x/callback?state=attacker&code=mock&mock=1",
      { redirect: "manual" },
    );
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const loc = res.headers.get("Location") || "";
    expect(loc).toContain("sign=error");
    expect(decodeURIComponent(loc)).toMatch(/Invalid authentication/i);
  });

  it("requires browser flow cookie for callback", async () => {
    const res = await fetchWorker(
      "/api/auth/x/callback?state=some-state&code=real-looking-code",
      { redirect: "manual" },
    );
    expect(res.status).toBeGreaterThanOrEqual(300);
    const loc = res.headers.get("Location") || "";
    expect(decodeURIComponent(loc)).toMatch(/this browser/i);
  });

  it("clamps negative pagination limits", async () => {
    const res = await fetchWorker("/api/signatories?limit=-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { limit: number };
    expect(body.limit).toBe(1);
  });

  it("rejects disallowed CORS origins on API", async () => {
    const res = await fetchWorker("/api/stats", {
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("allows same-site origin", async () => {
    const res = await fetchWorker("/api/health", {
      headers: { Origin: "http://localhost:8787" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:8787",
    );
  });

  it("does not expose GET oauth start", async () => {
    const res = await fetchWorker("/api/auth/x/start");
    expect(res.status).toBe(404);
  });

  it("accepts edit intent on oauth start without leaking secrets", async () => {
    const res = await fetchWorker("/api/auth/x/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:8787",
        "CF-Connecting-IP": "198.51.100.9",
      },
      body: JSON.stringify({
        intent: "edit",
        title: "Engineer",
        comment: "Updated",
      }),
    });
    // 200 mock redirect or 500 if OAuth not configured — never 404
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = (await res.json()) as { intent?: string; redirectUrl?: string };
      expect(body.intent).toBe("edit");
      expect(body.redirectUrl).toBeTruthy();
    }
  });

  it("rejects bodies larger than 8KB on oauth start", async () => {
    const big = "x".repeat(9_000);
    const res = await fetchWorker("/api/auth/x/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:8787",
      },
      body: JSON.stringify({ comment: big }),
    });
    expect(res.status).toBe(413);
  });

  it("rate-limits oauth start after 10 requests from same IP", async () => {
    const init: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:8787",
        "CF-Connecting-IP": "203.0.113.50",
      },
      body: "{}",
    };

    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await fetchWorker("/api/auth/x/start", init);
      lastStatus = res.status;
      // First 10 may be 200 (mock path needs X_DEV_MOCK or secrets) or 500
      // (OAuth not configured). Rate limit must still count attempts.
      if (i < 10) {
        expect([200, 500]).toContain(res.status);
      }
    }
    expect(lastStatus).toBe(429);
  });
});
