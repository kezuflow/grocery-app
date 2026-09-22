import type { Unstable_Config } from "wrangler";

export type DevelopmentDataMode = "local" | "shared-staging";

/**
 * Ordinary Vite development is isolated. Remote staging data is available only
 * through the exact, explicit opt-in used by `pnpm dev:shared-staging`.
 */
export function resolveDevelopmentDataMode(
  command: "build" | "serve",
  environment: Readonly<Record<string, string | undefined>>,
): DevelopmentDataMode {
  if (command !== "serve" || environment.CLOUDFLARE_ENV) return "local";
  const requested = environment.FRESHMARKETS_DEV_DATA?.trim() || "local";
  if (requested === "local" || requested === "shared-staging") return requested;
  throw new Error(
    `Unsupported FRESHMARKETS_DEV_DATA=${JSON.stringify(requested)}. Use "local" or the explicit "shared-staging" opt-in.`,
  );
}

/** Set the auxiliary Core bindings for ordinary local or explicit shared staging development. */
export function configureCoreDevelopmentBindings(
  local: Unstable_Config,
  staging: Unstable_Config | undefined,
): void {
  if (!staging) {
    Object.assign(local, { send_email: [] });
    return;
  }
  // Replace binding arrays in place: returning arrays lets the plugin's
  // default merge append the old local bindings.
  Object.assign(local, {
    vars: {
      ...local.vars,
      ...staging.vars,
      ENVIRONMENT: "development",
      BETTER_AUTH_URL: "http://localhost:3000",
      TRUSTED_ORIGINS: "http://localhost:3000,http://127.0.0.1:3000",
      PAYMENT_PROVIDER: "disabled",
      DELIVERY_PROVIDER: "disabled",
      DELIVERY_PROVIDERS: "disabled",
    },
    d1_databases: staging.d1_databases.map((binding) => ({
      ...binding,
      remote: true,
    })),
    r2_buckets: staging.r2_buckets.map((binding) => ({
      ...binding,
      remote: true,
    })),
    send_email: [],
    // A deployed staging Core can consume outbox rows written to shared D1.
    // Local Queue and cron effects stay disabled in this mode.
    queues: { producers: [], consumers: [] },
    triggers: { crons: [] },
  });
}
