import { defineConfig } from "vitest/config";

// `pnpm test`: unit tests for the security-critical rules. The browser and end-to-end scripts live in the git-ignored
// .unlazy/ folder, as the project's stack asks (see .unlazy/README.md).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "api",
          root: "artifacts/api-server",
          include: ["src/**/*.test.ts"],
          environment: "node",
          // No database or network: these modules read their settings from the environment at import time.
          env: { NODE_ENV: "test", LOG_LEVEL: "silent" },
        },
      },
      {
        test: { name: "web", root: "artifacts/grant-platform", include: ["src/**/*.test.ts"], environment: "node" },
      },
    ],
  },
});
