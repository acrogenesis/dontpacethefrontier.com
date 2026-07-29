import type { Env } from "./env";
import { pkceChallenge, pkceVerifier, randomToken } from "./crypto";
import { mockEnabled as mockEnabledFromSecurity, sanitizeAvatarUrl } from "./security";

const AUTH_URL = "https://twitter.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const ME_URL =
  "https://api.twitter.com/2/users/me?user.fields=profile_image_url,name,username";

export type XUser = {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
};

export type Draft = {
  company: string | null;
  title: string | null;
  comment: string | null;
};

function appOrigin(env: Env, requestUrl: string): string {
  return (env.APP_URL || new URL(requestUrl).origin).replace(/\/$/, "");
}

export function callbackUrl(env: Env, requestUrl: string): string {
  return `${appOrigin(env, requestUrl)}/api/auth/x/callback`;
}

export function hasXCredentials(env: Env): boolean {
  return Boolean(env.X_CLIENT_ID && env.X_CLIENT_SECRET);
}

/** Mock auth only when X_DEV_MOCK=1 (local). Never trust query params alone. */
export function mockEnabled(env: Env): boolean {
  return mockEnabledFromSecurity(env);
}

export type StartResult = {
  redirectUrl: string;
  flowId: string;
};

/** Persist draft + PKCE + browser flow id; return authorize URL (or mock if enabled). */
export async function startXAuth(
  env: Env,
  requestUrl: string,
  draft: Draft,
): Promise<StartResult> {
  const useMock = mockEnabled(env);

  if (!useMock && !hasXCredentials(env)) {
    throw new Error(
      "X OAuth is not configured. Set X_CLIENT_ID and X_CLIENT_SECRET in .dev.vars (local) or wrangler secrets (prod).",
    );
  }

  const state = randomToken(24);
  const flowId = randomToken(24);
  const codeVerifier = pkceVerifier();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await env.DB.prepare(
    "DELETE FROM oauth_states WHERE expires_at < datetime('now')",
  ).run();

  await env.DB.prepare(
    `INSERT INTO oauth_states
      (state, code_verifier, company, title, comment, anonymous, expires_at, flow_id)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(
      state,
      codeVerifier,
      draft.company,
      draft.title,
      draft.comment,
      expiresAt,
      flowId,
    )
    .run();

  if (useMock) {
    const origin = appOrigin(env, requestUrl);
    // Mock path is only reachable when mockEnabled(env) is true on callback too.
    return {
      redirectUrl: `${origin}/api/auth/x/callback?state=${encodeURIComponent(state)}&code=mock`,
      flowId,
    };
  }

  const challenge = await pkceChallenge(codeVerifier);
  const redirectUri = callbackUrl(env, requestUrl);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.X_CLIENT_ID!,
    redirect_uri: redirectUri,
    scope: "tweet.read users.read",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  return { redirectUrl: `${AUTH_URL}?${params}`, flowId };
}

export type OAuthStateRow = {
  state: string;
  code_verifier: string;
  company: string | null;
  title: string | null;
  comment: string | null;
  expires_at: string;
  flow_id: string | null;
};

/**
 * Atomically consume OAuth state (single-use).
 * D1/SQLite DELETE … RETURNING is required — no non-atomic SELECT/DELETE fallback.
 */
export async function loadAndConsumeState(
  env: Env,
  state: string,
): Promise<OAuthStateRow | null> {
  const row = await env.DB.prepare(
    `DELETE FROM oauth_states
     WHERE state = ? AND expires_at >= datetime('now')
     RETURNING state, code_verifier, company, title, comment, expires_at, flow_id`,
  )
    .bind(state)
    .first<OAuthStateRow>();
  return row ?? null;
}

/**
 * Exchange code for X user.
 * Mock path ONLY when mockEnabled(env) is true — never from query params alone.
 */
export async function exchangeCodeForUser(
  env: Env,
  requestUrl: string,
  code: string,
  codeVerifier: string,
): Promise<XUser> {
  const allowMock = mockEnabled(env);
  const wantsMock = code === "mock";

  if (wantsMock) {
    if (!allowMock) {
      throw new Error("Mock authentication is disabled");
    }
    const n = Math.floor(Math.random() * 9000) + 1000;
    return {
      id: `mock_${n}`,
      username: `dev_user_${n}`,
      name: `Dev User ${n}`,
      avatarUrl: null,
    };
  }

  if (!hasXCredentials(env)) {
    throw new Error("X OAuth is not configured");
  }

  const basic = btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`);
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: env.X_CLIENT_ID!,
    redirect_uri: callbackUrl(env, requestUrl),
    code_verifier: codeVerifier,
  });

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
  });

  if (!tokenRes.ok) {
    console.error("X token error", tokenRes.status);
    throw new Error("Failed to complete X login");
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error("No access token from X");

  const meRes = await fetch(ME_URL, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });

  if (!meRes.ok) {
    console.error("X me error", meRes.status);
    throw new Error(
      `Failed to fetch X profile (${meRes.status}). If you just changed scopes, revoke the app on X and sign again.`,
    );
  }

  const me = (await meRes.json()) as {
    data?: {
      id: string;
      username: string;
      name: string;
      profile_image_url?: string;
    };
  };

  if (!me.data?.id || !me.data.username) {
    throw new Error("Invalid X profile response");
  }

  return {
    id: me.data.id,
    username: me.data.username,
    name: me.data.name || me.data.username,
    avatarUrl: sanitizeAvatarUrl(
      me.data.profile_image_url?.replace("_normal", "_400x400") ?? null,
    ),
  };
}
