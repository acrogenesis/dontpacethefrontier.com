import { applyD1Migrations, env } from "cloudflare:test";

// TEST_MIGRATIONS is injected in vitest.config.ts via readD1Migrations()
await applyD1Migrations(
  env.DB,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (env as any).TEST_MIGRATIONS,
);
