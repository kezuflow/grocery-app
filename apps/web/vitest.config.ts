import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
  test: {
    environment: "node",
    // Playwright operational specs live in tests/ and run via `test:e2e`
    // against a provisioned stack, never under vitest.
    exclude: ["**/node_modules/**", "dist/**", "tests/**"],
  },
});
