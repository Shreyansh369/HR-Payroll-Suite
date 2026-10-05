import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // Server-only modules are imported directly by integration tests.
    alias: { "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)) },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
  },
});
