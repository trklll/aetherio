import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["worker/awards/__tests__/**/*.test.ts", "worker/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
    globals: false,
  },
});
