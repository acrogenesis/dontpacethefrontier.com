import type { Env } from "./env";

const MAX_BODY_BYTES = 8_192;
const OAUTH_START_LIMIT = 10;
const OAUTH_START_WINDOW_MS = 15 * 60 * 1000;
export const FLOW_COOKIE = "dptf_oauth_flow";
const FLOW_TTL_SEC = 15 * 60;

export function allowedOrigins(env: Env): string[] {
  const origins = new Set<string>();
  if (env.APP_URL) {
    try {
      origins.add(new URL(env.APP_URL).origin);
    } catch {
      /* ignore */
    }
  }
  origins.add("http://localhost:8787");
  origins.add("http://127.0.0.1:8787");
  return [...origins];
}

export function corsOrigin(env: Env, request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  return allowedOrigins(env).includes(origin) ? origin : null;
}

/** True when request has a disallowed browser Origin (CSRF / cross-site abuse). */
export function isDisallowedOrigin(env: Env, request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false; // non-browser or same-origin navigations
  return corsOrigin(env, request) === null;
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function readJsonLimited(
  request: Request,
  maxBytes = MAX_BODY_BYTES,
): Promise<Record<string, unknown>> {
  const len = request.headers.get("Content-Length");
  if (len && Number(len) > maxBytes) {
    throw new BodyTooLargeError();
  }
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) {
    throw new BodyTooLargeError();
  }
  if (buf.byteLength === 0) return {};
  try {
    const parsed = JSON.parse(new TextDecoder().decode(buf));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new InvalidJsonError();
  }
}

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "BodyTooLargeError";
  }
}

export class InvalidJsonError extends Error {
  constructor() {
    super("Invalid JSON");
    this.name = "InvalidJsonError";
  }
}

export class RateLimitError extends Error {
  constructor() {
    super("Too many requests. Please try again later.");
    this.name = "RateLimitError";
  }
}

/**
 * Atomic fixed-window rate limit via single D1 UPSERT + RETURNING.
 * SQLite serializes writes on a row, so concurrent requests cannot each
 * independently ignore the counter.
 *
 * Optionally uses Cloudflare Rate Limiting binding when present (env.OAUTH_RATE_LIMITER).
 */
export async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  // Prefer platform rate limiter when configured
  const limiter = (env as Env & { OAUTH_RATE_LIMITER?: { limit: (o: { key: string }) => Promise<{ success: boolean }> } }).OAUTH_RATE_LIMITER;
  if (limiter && typeof limiter.limit === "function") {
    const { success } = await limiter.limit({ key });
    if (!success) throw new RateLimitError();
    return;
  }

  const now = Date.now();

  // Opportunistic prune of stale windows (outside hot path critical section is fine)
  await env.DB.prepare(
    "DELETE FROM rate_limits WHERE window_start_ms < ?",
  )
    .bind(now - windowMs * 2)
    .run();

  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, window_start_ms)
     VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE
         WHEN ? - rate_limits.window_start_ms > ? THEN 1
         ELSE rate_limits.count + 1
       END,
       window_start_ms = CASE
         WHEN ? - rate_limits.window_start_ms > ? THEN excluded.window_start_ms
         ELSE rate_limits.window_start_ms
       END
     RETURNING count`,
  )
    .bind(key, now, now, windowMs, now, windowMs)
    .first<{ count: number }>();

  if (!row || row.count > limit) {
    throw new RateLimitError();
  }
}

export async function rateLimitOAuthStart(
  env: Env,
  request: Request,
): Promise<void> {
  const ip = clientIp(request);
  await rateLimit(
    env,
    `oauth_start:${ip}`,
    OAUTH_START_LIMIT,
    OAUTH_START_WINDOW_MS,
  );
}

export function flowCookieHeader(flowId: string, requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:";
  const parts = [
    `${FLOW_COOKIE}=${flowId}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${FLOW_TTL_SEC}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearFlowCookieHeader(requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:";
  const parts = [
    `${FLOW_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readFlowCookie(request: Request): string | null {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === FLOW_COOKIE) {
      const v = rest.join("=").trim();
      return v || null;
    }
  }
  return null;
}

export function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function sanitizeAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    if (
      host === "pbs.twimg.com" ||
      host.endsWith(".twimg.com") ||
      host === "abs.twimg.com"
    ) {
      return u.toString();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sanitize optional user-authored text (title, comment).
 * - No HTML / scripting markup
 * - No URLs or common link forms (displayed comments stay plain text)
 * - Keeps newlines; strips other control chars
 * Safe even if the client ever used innerHTML (we still render via text nodes).
 */
export function sanitizeUserText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  let t = v.normalize("NFC");

  // Drop null + control chars except tab/newline/carriage return
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/g, "");

  // HTML tags and residual brackets (no markup)
  t = t.replace(/<[^>]*>/g, " ");
  t = t.replace(/[<>]/g, "");

  // Markdown / common link forms: [label](url) → label
  t = t.replace(/\[([^\]]*)\]\((?:https?:\/\/|\/\/|www\.)[^)\s]+\)/gi, "$1");
  t = t.replace(/\[([^\]]*)\]\([^)\s]+\)/g, "$1");

  // URLs and schemes (http, https, protocol-relative, bare www.)
  t = t.replace(/https?:\/\/[^\s<>"']+/gi, " ");
  t = t.replace(/\/\/[^\s<>"']+/g, " ");
  t = t.replace(/\bwww\.[^\s<>"']+/gi, " ");
  t = t.replace(/\b(?:javascript|data|vbscript)\s*:/gi, "");

  // Collapse space left by removals; keep paragraph breaks
  t = t.replace(/[^\S\n]+/g, " ");
  t = t.replace(/ ?\n ?/g, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  t = t.trim().slice(0, max);
  return t || null;
}

export function mockEnabled(env: { X_DEV_MOCK?: string }): boolean {
  return env.X_DEV_MOCK === "1";
}

/** Whether mock query/code should be accepted (must match production policy). */
export function shouldAcceptMockAuth(
  env: { X_DEV_MOCK?: string },
  code: string,
  mockQuery: string | undefined,
): boolean {
  const wantsMock = mockQuery === "1" || code === "mock";
  if (!wantsMock) return false;
  return mockEnabled(env);
}

export function securityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://pbs.twimg.com https://abs.twimg.com https://*.twimg.com",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  };
}

export function withSecurityHeaders(res: Response): Response {
  // Important: `new Headers(res.headers)` can drop Set-Cookie in Workers/Fetch.
  const headers = new Headers();
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    headers.set(key, value);
  });
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [];
  if (setCookies.length) {
    for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  } else {
    const single = res.headers.get("Set-Cookie");
    if (single) headers.append("Set-Cookie", single);
  }
  for (const [k, v] of Object.entries(securityHeaders())) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
