import type { Env } from "./env";
import { pkceChallenge, pkceVerifier, randomToken } from "./crypto";
import { mockEnabled as mockEnabledFromSecurity, sanitizeAvatarUrl } from "./security";

const AUTH_URL = "https://twitter.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
/** Affiliation is X's official org badge link (e.g. @sama → OpenAI). */
const ME_URL =
  "https://api.twitter.com/2/users/me?user.fields=profile_image_url,name,username,affiliation&expansions=affiliation.user_id";

export type XUser = {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  /** From X profile affiliation (org account name), never free-text. */
  company: string | null;
  /** Affiliated org's @handle when available. */
  companyHandle: string | null;
};

export type Draft = {
  title: string | null;
  comment: string | null;
};

type AffiliationPayload = {
  badge_url?: string;
  description?: string;
  url?: string;
  /** Legacy single id or current array of org account ids */
  user_id?: string | string[];
};

type MeUserPayload = {
  id: string;
  username: string;
  name: string;
  profile_image_url?: string;
  affiliation?: AffiliationPayload | null;
};

type MeResponse = {
  data?: MeUserPayload;
  includes?: {
    users?: Array<{
      id: string;
      name?: string;
      username?: string;
    }>;
  };
};

/** Normalize affiliation.user_id (string | string[]) to id list. */
export function affiliationUserIds(
  userId: string | string[] | undefined | null,
): string[] {
  if (userId == null) return [];
  if (Array.isArray(userId)) {
    return userId.filter((id): id is string => typeof id === "string" && id.length > 0);
  }
  if (typeof userId === "string" && userId.length > 0) return [userId];
  return [];
}

/**
 * Resolve display company from X affiliation + expanded org users.
 * Prefers the org account's profile name (e.g. "OpenAI"), then affiliation description.
 */
export function companyFromAffiliation(
  affiliation: AffiliationPayload | null | undefined,
  includesUsers: Array<{ id: string; name?: string; username?: string }> = [],
): { company: string | null; companyHandle: string | null } {
  if (!affiliation) return { company: null, companyHandle: null };

  const ids = affiliationUserIds(affiliation.user_id);
  for (const id of ids) {
    const org = includesUsers.find((u) => u.id === id);
    if (!org) continue;
    const name = typeof org.name === "string" ? org.name.trim() : "";
    if (name) {
      return {
        company: name.slice(0, 120),
        companyHandle:
          typeof org.username === "string" && org.username
            ? org.username.slice(0, 15)
            : null,
      };
    }
  }

  const desc =
    typeof affiliation.description === "string"
      ? affiliation.description.trim()
      : "";
  if (desc) {
    return { company: desc.slice(0, 120), companyHandle: null };
  }

  return { company: null, companyHandle: null };
}

/** sign = create new; edit = update existing after re-auth with X */
export type AuthIntent = "sign" | "edit";

export function parseAuthIntent(raw: unknown): AuthIntent {
  return raw === "edit" ? "edit" : "sign";
}

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
  intent: AuthIntent = "sign",
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
  const safeIntent: AuthIntent = intent === "edit" ? "edit" : "sign";

  await env.DB.prepare(
    "DELETE FROM oauth_states WHERE expires_at < datetime('now')",
  ).run();

  await env.DB.prepare(
    `INSERT INTO oauth_states
      (state, code_verifier, company, title, comment, anonymous, expires_at, flow_id, intent)
     VALUES (?, ?, NULL, ?, ?, 0, ?, ?, ?)`,
  )
    .bind(
      state,
      codeVerifier,
      draft.title,
      draft.comment,
      expiresAt,
      flowId,
      safeIntent,
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
  intent: string | null;
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
     RETURNING state, code_verifier, company, title, comment, expires_at, flow_id, intent`,
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
      // Mock has no real affiliation
      company: null,
      companyHandle: null,
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

  const me = (await meRes.json()) as MeResponse;

  if (!me.data?.id || !me.data.username) {
    throw new Error("Invalid X profile response");
  }

  const { company, companyHandle } = companyFromAffiliation(
    me.data.affiliation,
    me.includes?.users ?? [],
  );

  return {
    id: me.data.id,
    username: me.data.username,
    name: me.data.name || me.data.username,
    avatarUrl: sanitizeAvatarUrl(
      me.data.profile_image_url?.replace("_normal", "_400x400") ?? null,
    ),
    company,
    companyHandle,
  };
}
