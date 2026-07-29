# Don't Pace the Frontier

Community counter-statement to [Pacing the Frontier](https://www.pacingthefrontier.com/): ship the best models fast, at fair prices, with high limits.

**Stack:** Cloudflare Workers + static assets + D1  
**Verification:** **Sign with X** (OAuth 2.0 + PKCE). One signature per X account.

## Why X for a community petition

| | X OAuth | Email magic link |
|---|---|---|
| Friction | One tap for people already on X | Check inbox |
| Viral loop | Handle + avatar on the wall | Anonymous unless named |
| Fake accounts | Possible but higher cost | Disposable emails easy |
| Company proof | Self-reported only | Strong with corporate domains |
| Fit | **Community petition** | Employee-only letter |

Company/title are optional self-reported fields. Identity = verified X user id.

## Local dev

```bash
npm install
npx wrangler d1 migrations apply dontpacethefrontier --local
npm run dev
```

Open http://localhost:8787  

Copy `.dev.vars.example` → `.dev.vars` and set your X OAuth Client ID/Secret.  
Optional local-only mock: set `X_DEV_MOCK=1` (never enable this in production).

## X Developer App setup

### Important: API Key ≠ OAuth 2.0 Client ID

When you create an app you often get:

| Portal label | What it is | Used for Sign with X? |
|---|---|---|
| Consumer Key / API Key | OAuth 1.0a | No (alone) |
| Secret Key / API Secret | OAuth 1.0a | No (alone) |
| Bearer Token | App-only | No |
| **Client ID** | OAuth 2.0 | **Yes** |
| **Client Secret** | OAuth 2.0 | **Yes** |

### Enable user login (OAuth 2.0)

1. [developer.x.com](https://developer.x.com/) → your app → **User authentication settings** → Edit.
2. Turn on **OAuth 2.0**.
3. App type: **Web App**.
4. Callback URLs:
   - `http://localhost:8787/api/auth/x/callback`
   - `https://dontpacethefrontier.com/api/auth/x/callback`
   - your `*.workers.dev` URL if needed
5. Website URL: `https://dontpacethefrontier.com`
6. Privacy policy URL: `https://dontpacethefrontier.com/privacy`
   (local: `http://localhost:8787/privacy.html`)
7. Scopes: **Read** (we request `tweet.read users.read` — X requires both for `/2/users/me`; we only use profile fields, not posts. No `offline.access`).
8. Save, then copy **Client ID** and **Client Secret** (not the Consumer Key).

### Local secrets

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars with Client ID + Client Secret
```

Wrangler loads `.dev.vars` automatically for `npm run dev`. That file is gitignored.

### Production secrets

```bash
npx wrangler secret put X_CLIENT_ID
npx wrangler secret put X_CLIENT_SECRET
```

Set in `wrangler.toml` or dashboard:

```toml
APP_URL = "https://dontpacethefrontier.com"
X_DEV_MOCK = "0"
```

## Deploy

```bash
# Create remote D1 once
npx wrangler d1 create dontpacethefrontier
# paste database_id into wrangler.toml

npx wrangler d1 migrations apply dontpacethefrontier --remote
npm run deploy
```

Attach custom domain **dontpacethefrontier.com** in Workers → Domains & Routes (after DNS is on Cloudflare).

## Auth flow

1. User optionally fills company / title / comment.
2. `POST /api/auth/x/start` stores draft + PKCE verifier + browser flow id (HttpOnly cookie), returns X authorize URL.
3. User approves on X → `GET /api/auth/x/callback` (cookie must match).
4. We exchange code, fetch `/2/users/me`, insert signatory (unique on `x_user_id`).
5. Redirect home with `?sign=ok`.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness (`{ "ok": true }`) |
| GET | `/api/stats` | Totals + company breakdown |
| GET | `/api/signatories` | Paginated public list |
| GET | `/api/comments` | Signatures with comments |
| POST | `/api/auth/x/start` | Begin OAuth (`{ company, title, comment }`) |
| GET | `/api/auth/x/callback` | X redirect target |

We never store email. Public API never exposes `x_user_id`.

## Security

Report vulnerabilities privately via [SECURITY.md](./SECURITY.md).

```bash
npm test                 # unit + Worker integration (Vitest)
npm run cf-typegen       # regenerate types from .dev.vars.example only
npm run check            # types --check + tsc + tests + dry-run
```

Do not commit `.dev.vars` — only `.dev.vars.example`. Regenerate types with:

```bash
npm run cf-typegen
```

(never `wrangler types` against a private `.dev.vars` for committed output).
## License

MIT — see [LICENSE](./LICENSE).
