import { Hono } from "hono";
import type { Env } from "./env";
import {
  exchangeCodeForUser,
  loadAndConsumeState,
  mockEnabled,
  parseAuthIntent,
  startXAuth,
} from "./x-oauth";
import {
  BodyTooLargeError,
  InvalidJsonError,
  RateLimitError,
  clampInt,
  clearFlowCookieHeader,
  corsOrigin,
  flowCookieHeader,
  rateLimitOAuthStart,
  readFlowCookie,
  readJsonLimited,
  sanitizeAvatarUrl,
  shouldAcceptMockAuth,
  withSecurityHeaders,
} from "./security";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => {
  // Reject cross-origin browser calls that are not on the allowlist
  const originHeader = c.req.header("Origin");
  if (originHeader) {
    const allowed = corsOrigin(c.env, c.req.raw);
    if (!allowed) {
      if (c.req.method === "OPTIONS") {
        return c.body(null, 403);
      }
      return c.json({ error: "Origin not allowed" }, 403);
    }
    c.header("Access-Control-Allow-Origin", allowed);
    c.header("Vary", "Origin");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type");
    c.header("Access-Control-Allow-Credentials", "true");
  }
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }
  await next();
});

function publicSignatory(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    title: row.title,
    xHandle: row.x_handle,
    avatarUrl: sanitizeAvatarUrl(
      typeof row.avatar_url === "string" ? row.avatar_url : null,
    ),
    comment: row.comment,
    createdAt: row.created_at,
    verifiedVia: "x" as const,
  };
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

// ---------- API ----------

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/stats", async (c) => {
  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM signatories",
  ).first<{ n: number }>();

  const byCompany = await c.env.DB.prepare(
    `SELECT COALESCE(company, 'Independent / Other') AS company,
            COUNT(*) AS count
     FROM signatories
     GROUP BY COALESCE(company, 'Independent / Other')
     ORDER BY count DESC
     LIMIT 50`,
  ).all();

  return c.json({
    total: total?.n ?? 0,
    byCompany: byCompany.results ?? [],
  });
});

app.get("/api/signatories", async (c) => {
  const limit = clampInt(c.req.query("limit"), 50, 1, 200);
  const offset = clampInt(c.req.query("offset"), 0, 0, 100_000);

  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM signatories",
  ).first<{ n: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT id, name, company, title, x_handle, avatar_url, comment, created_at
     FROM signatories
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all();

  return c.json({
    total: total?.n ?? 0,
    offset,
    limit,
    signatories: (rows.results ?? []).map((r) =>
      publicSignatory(r as Record<string, unknown>),
    ),
  });
});

app.get("/api/comments", async (c) => {
  const limit = clampInt(c.req.query("limit"), 30, 1, 100);
  const rows = await c.env.DB.prepare(
    `SELECT id, name, company, title, x_handle, avatar_url, comment, created_at
     FROM signatories
     WHERE comment IS NOT NULL AND TRIM(comment) != ''
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(limit)
    .all();

  return c.json({
    comments: (rows.results ?? []).map((r) =>
      publicSignatory(r as Record<string, unknown>),
    ),
  });
});

/** Dev-only: whether mock auth is on (not needed publicly in production). */
app.get("/api/dev/status", (c) => {
  if (!mockEnabled(c.env)) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json({ mockAuth: true });
});

/**
 * Start X OAuth (POST only). Sets browser-bound flow cookie.
 * Body: { title?, comment?, intent?: "sign" | "edit" }
 * Company is never taken from the client — only from X profile affiliation at callback.
 * - sign: create a new signature (default)
 * - edit: update an existing signature after re-auth (must already be signed)
 */
app.post("/api/auth/x/start", async (c) => {
  try {
    await rateLimitOAuthStart(c.env, c.req.raw);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return c.json({ error: e.message }, 429);
    }
    throw e;
  }

  let body: Record<string, unknown> = {};
  try {
    body = await readJsonLimited(c.req.raw);
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      return c.json({ error: e.message }, 413);
    }
    if (e instanceof InvalidJsonError) {
      return c.json({ error: e.message }, 400);
    }
    throw e;
  }

  const draft = {
    title: cleanText(body.title, 160),
    comment: cleanText(body.comment, 2000),
  };
  const intent = parseAuthIntent(body.intent);

  try {
    const { redirectUrl, flowId } = await startXAuth(
      c.env,
      c.req.url,
      draft,
      intent,
    );
    // Explicit Response so Set-Cookie is preserved through security header wrap
    return new Response(JSON.stringify({ ok: true, redirectUrl, intent }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": flowCookieHeader(flowId, c.req.url),
      },
    });
  } catch (e) {
    console.error("oauth start failed", e instanceof Error ? e.name : "error");
    const message =
      e instanceof Error ? e.message : "Could not start X sign-in";
    return c.json({ error: message }, 500);
  }
});

/** X redirects here after user authorizes. */
app.get("/api/auth/x/callback", async (c) => {
  const origin = (c.env.APP_URL || new URL(c.req.url).origin).replace(
    /\/$/,
    "",
  );
  const clearCookie = clearFlowCookieHeader(c.req.url);

  const redirect = (pathQuery: string) => {
    const res = c.redirect(`${origin}${pathQuery}`);
    res.headers.append("Set-Cookie", clearCookie);
    return res;
  };

  const err = c.req.query("error");
  if (err) {
    const desc = c.req.query("error_description") || err;
    return redirect(
      `/?sign=error&message=${encodeURIComponent(desc)}`,
    );
  }

  const state = c.req.query("state") || "";
  const code = c.req.query("code") || "";

  // Reject attacker-controlled mock flags unless mock mode is enabled in env
  if (
    (c.req.query("mock") === "1" || code === "mock") &&
    !shouldAcceptMockAuth(c.env, code, c.req.query("mock") ?? undefined)
  ) {
    return redirect(
      `/?sign=error&message=${encodeURIComponent("Invalid authentication request")}`,
    );
  }

  if (!state || !code) {
    return redirect(
      `/?sign=error&message=${encodeURIComponent("Missing OAuth parameters")}`,
    );
  }

  const cookieFlow = readFlowCookie(c.req.raw);
  if (!cookieFlow) {
    return redirect(
      `/?sign=error&message=${encodeURIComponent("Sign-in must be started in this browser. Please try again.")}`,
    );
  }

  const row = await loadAndConsumeState(c.env, state);
  if (!row) {
    return redirect(
      `/?sign=error&message=${encodeURIComponent("Sign-in expired. Please try again.")}`,
    );
  }

  // Browser-bound flow: cookie must match the OAuth start that created this state
  if (!row.flow_id || row.flow_id !== cookieFlow) {
    return redirect(
      `/?sign=error&message=${encodeURIComponent("Sign-in session mismatch. Please try again from this site.")}`,
    );
  }

  let user;
  try {
    user = await exchangeCodeForUser(
      c.env,
      c.req.url,
      code,
      row.code_verifier,
    );
  } catch (e) {
    console.error("oauth callback failed", e instanceof Error ? e.name : "error");
    return redirect(
      `/?sign=error&message=${encodeURIComponent("X login failed. Please try again.")}`,
    );
  }

  const intent = row.intent === "edit" ? "edit" : "sign";
  const existing = await c.env.DB.prepare(
    "SELECT id FROM signatories WHERE x_user_id = ?",
  )
    .bind(user.id)
    .first<{ id: string }>();

  if (intent === "edit") {
    if (!existing) {
      return redirect(
        `/?sign=error&message=${encodeURIComponent("No signature found for this X account. Sign first.")}`,
      );
    }
    // Only the re-authenticated X user can update their row.
    // Company always comes from X affiliation on this re-auth (not client input).
    await c.env.DB.prepare(
      `UPDATE signatories SET
         x_handle = ?,
         name = ?,
         avatar_url = ?,
         company = ?,
         title = ?,
         comment = ?,
         updated_at = datetime('now')
       WHERE x_user_id = ?`,
    )
      .bind(
        user.username,
        user.name,
        user.avatarUrl,
        user.company,
        row.title,
        row.comment,
        user.id,
      )
      .run();
    return redirect("/?sign=updated");
  }

  if (existing) {
    return redirect("/?sign=already");
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO signatories
      (id, x_user_id, x_handle, name, avatar_url, company, title, comment, anonymous)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  )
    .bind(
      id,
      user.id,
      user.username,
      user.name,
      user.avatarUrl,
      user.company,
      row.title,
      row.comment,
    )
    .run();

  return redirect("/?sign=ok");
});

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return withSecurityHeaders(Response.redirect(url.toString(), 301));
    }
    const res = await app.fetch(request, env, ctx);
    return withSecurityHeaders(res);
  },
};
