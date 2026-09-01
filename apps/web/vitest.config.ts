import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      "next/link": "vinext/shims/link",
    },
  },
  test: {
    environment: "node",
    // App Router unit tests mirror app/ under test/app so vinext's app-source
    // optimizer crawl never sees Vitest or jsdom as runtime dependencies.
    // Playwright operational specs live in tests/ and run via `test:e2e`
    // against a provisioned stack, never under vitest.
    exclude: ["**/node_modules/**", "dist/**", "tests/**"],
  },
});
