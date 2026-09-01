import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  optimizeDeps: {
    // vinext treats every source file under app/ as an optimizer entry. Keep
    // test-only runtimes out if they are imported accidentally in the future.
    exclude: ["vitest", "jsdom"],
  },
  plugins: [
    vinext(),
    cloudflare({
      configPath: "./wrangler.jsonc",
      auxiliaryWorkers: [{ configPath: "../core/wrangler.jsonc" }],
      persistState: { path: "../core/.wrangler/state" },
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
