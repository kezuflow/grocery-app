import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { unstable_readConfig, type Unstable_Config } from "wrangler";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export default defineConfig(({ command }) => {
  // The owner uses localhost against the live FreshMarkets data. Keep build/test
  // configs local unless a deployment environment is selected explicitly.
  const sharedData =
    command === "serve" &&
    !process.env.CLOUDFLARE_ENV &&
    process.env.FRESHMARKETS_DEV_DATA !== "local";
  if (sharedData) {
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
            ...(staging
              ? {
                  config: (local) => {
                    // Replace binding arrays in place: returning arrays lets the
                    // plugin's default merge append the old local bindings.
                    Object.assign(local, {
                      vars: {
                        ...local.vars,
                        ...staging.vars,
                        ENVIRONMENT: "development",
                        BETTER_AUTH_URL: "http://localhost:3000",
                        TRUSTED_ORIGINS: "http://localhost:3000,http://127.0.0.1:3000",
                      },
                      d1_databases: staging.d1_databases.map((binding) => ({
                        ...binding,
                        remote: true,
                      })),
                      r2_buckets: staging.r2_buckets.map((binding) => ({
                        ...binding,
                        remote: true,
                      })),
                      send_email: staging.send_email.map((binding) => ({
                        ...binding,
                        remote: true,
                      })),
                      // Commands persist notification intent in the shared D1 outbox.
                      // Deployed Core owns its scheduled publication and delivery.
                      // Remote Queue bindings currently fail with Cloudflare 1105;
                      // never substitute a simulated queue against shared data.
                      queues: { producers: [], consumers: [] },
                      triggers: { crons: [] },
                    });
                  },
                }
              : {}),
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
