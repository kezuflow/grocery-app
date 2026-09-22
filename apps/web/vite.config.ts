import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { unstable_readConfig, type Unstable_Config } from "wrangler";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { configureCoreDevelopmentBindings, resolveDevelopmentDataMode } from "./dev-data-mode.ts";

export default defineConfig(({ command }) => {
  const sharedData = resolveDevelopmentDataMode(command, process.env) === "shared-staging";
  if (sharedData) {
    process.stderr.write(
      "WARNING: using remote freshmarkets staging D1/R2. Direct local email, queue, cron, payment, and delivery effects are disabled; writes still mutate shared data and deployed staging may consume outbox rows.\n",
    );
    // Wrangler loads this ignored file for Core; never use the predictable
    // development fallback to sign sessions against the shared database.
    const secrets = existsSync("../core/.dev.vars")
      ? parseEnv(readFileSync("../core/.dev.vars", "utf8"))
      : {};
    if (
      !secrets.BETTER_AUTH_SECRET ||
      secrets.BETTER_AUTH_SECRET.length < 32 ||
      secrets.BETTER_AUTH_SECRET === "freshmarkets-local-only-auth-secret-32-characters"
    ) {
      throw new Error(
        "Shared-data development requires a private BETTER_AUTH_SECRET in apps/core/.dev.vars (32+ characters).",
      );
    }
  }
  const staging: Unstable_Config | undefined = sharedData
    ? unstable_readConfig({ config: "../core/wrangler.jsonc", env: "staging" })
    : undefined;
  const webStaging: Unstable_Config | undefined = sharedData
    ? unstable_readConfig({ config: "./wrangler.jsonc", env: "staging" })
    : undefined;
  return {
    optimizeDeps: {
      // vinext treats every source file under app/ as an optimizer entry. Keep
      // test-only runtimes out if they are imported accidentally in the future.
      // Vinext's client-marked Link shim owns the App Router prefetch queue.
      // Exclude its package graph and Lucide's client modules so RSC and browser
      // transforms do not assign different optimized identities.
      exclude: ["next/link", "vinext", "lucide-react", "vitest", "jsdom"],
    },
    plugins: [
      vinext(),
      cloudflare({
        configPath: "./wrangler.jsonc",
        ...(webStaging
          ? {
              config: (local) => {
                Object.assign(local.vars, webStaging.vars, {
                  ENVIRONMENT: "development",
                  PUBLIC_APP_ORIGIN: "http://localhost:3000",
                });
              },
            }
          : {}),
        auxiliaryWorkers: [
          {
            configPath: "../core/wrangler.jsonc",
            config: (local) => {
              if (command === "serve" && !process.env.CLOUDFLARE_ENV)
                configureCoreDevelopmentBindings(local, staging);
            },
          },
        ],
        persistState: { path: "../core/.wrangler/state" },
        viteEnvironment: {
          name: "rsc",
          childEnvironments: ["ssr"],
        },
      }),
    ],
  };
});
