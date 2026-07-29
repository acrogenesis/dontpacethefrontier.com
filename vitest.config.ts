import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations"),
  );

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            APP_NAME: "Don't Pace the Frontier",
            APP_URL: "http://localhost:8787",
            X_DEV_MOCK: "0",
            X_CLIENT_ID: "",
            X_CLIENT_SECRET: "",
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./tests/apply-migrations.ts"],
      // Shared D1 across tests in a file; max-workers=1 for migration setup simplicity
      fileParallelism: false,
    },
  };
});
