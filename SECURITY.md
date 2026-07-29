# Security Policy

## Supported versions

Security fixes are applied to the latest code on the default branch and to the production deployment at [dontpacethefrontier.com](https://dontpacethefrontier.com).

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Email: **privacy@dontpacethefrontier.com** (or the maintainer contact listed on the site)

Include:

- Description of the issue and impact
- Steps to reproduce (proof of concept if possible)
- Affected URL / component if known

We will acknowledge reports when we can and aim to ship fixes for critical issues quickly.

## Scope notes

- Signatures are public by design (name, handle, X affiliation company if any, optional title/comment).
- Company is never free-text: only X profile `affiliation` (org badge) is stored.
- Authentication is via X OAuth 2.0 with PKCE.
- Mock OAuth is only for local development (`X_DEV_MOCK=1`) and must never be enabled in production.

## Out of scope (examples)

- Social engineering of end users to authorize the X app
- Issues solely in third-party services (X, Cloudflare) without a fix path in this repo
- Rate limits that do not affect confidentiality of private data
