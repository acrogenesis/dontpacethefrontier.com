import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { RateLimitError, rateLimit } from "../src/security";

describe("atomic rate limit (D1)", () => {
  it("allows exactly limit requests then rejects", async () => {
    const key = `test-boundary-${crypto.randomUUID()}`;
    const limit = 10;
    const windowMs = 60_000;

    for (let i = 0; i < limit; i++) {
      await expect(rateLimit(env, key, limit, windowMs)).resolves.toBeUndefined();
    }
    await expect(rateLimit(env, key, limit, windowMs)).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it("serializes concurrent increments without unbounded bursts", async () => {
    const key = `test-concurrency-${crypto.randomUUID()}`;
    const limit = 10;
    const windowMs = 60_000;

    // Fire more concurrent requests than the limit
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () => rateLimit(env, key, limit, windowMs)),
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    const limited = results.filter(
      (r) =>
        r.status === "rejected" && r.reason instanceof RateLimitError,
    ).length;

    // At most `limit` succeed; the rest must be rate-limited
    expect(ok).toBeLessThanOrEqual(limit);
    expect(ok).toBeGreaterThan(0);
    expect(limited).toBe(25 - ok);
    expect(ok + limited).toBe(25);
  });

  it("prunes stale windows so old keys do not accumulate forever", async () => {
    const key = `test-prune-${crypto.randomUUID()}`;
    const now = Date.now();
    // Insert a very old window row
    await env.DB.prepare(
      "INSERT INTO rate_limits (key, count, window_start_ms) VALUES (?, 5, ?)",
    )
      .bind(key, now - 60 * 60 * 1000)
      .run();

    // 1ms window → old row is outside 2×window prune threshold
    await rateLimit(env, `other-${crypto.randomUUID()}`, 10, 1);

    const gone = await env.DB.prepare(
      "SELECT key FROM rate_limits WHERE key = ?",
    )
      .bind(key)
      .first();

    expect(gone).toBeNull();
  });
});
