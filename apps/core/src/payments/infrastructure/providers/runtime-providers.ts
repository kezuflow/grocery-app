import type { PayMongoConfig, PayMongoProviderEnvironment } from "./paymongo-env";
import { PayMongoProvider } from "./paymongo-provider";
import { ProviderRegistry } from "./provider-registry";

export type RuntimePaymentsEnvironment = PayMongoProviderEnvironment & { ENVIRONMENT?: string };

/**
 * The single construction point for the production provider registry. An
 * adapter registers only when its configuration exists, so every payments
 * path fails closed with PAYMENT_PROVIDER_UNCONFIGURED until the operator
 * provisions credentials; the fake provider remains test-only through its own
 * registration guard.
 */
export function buildProviderRegistry(environment: RuntimePaymentsEnvironment): ProviderRegistry {
  const registry = new ProviderRegistry(environment.ENVIRONMENT);
  const config = payMongoConfigFrom(environment);
  if (config) registry.register(new PayMongoProvider(config), environment.ENVIRONMENT);
  return registry;
}

function payMongoConfigFrom(environment: PayMongoProviderEnvironment): PayMongoConfig | null {
  const secretKey = environment.PAYMONGO_SECRET_KEY;
  if (!secretKey) return null;
  return {
    secretKey,
    webhookSecretTest: environment.PAYMONGO_WEBHOOK_SECRET_TEST,
    webhookSecretLive: environment.PAYMONGO_WEBHOOK_SECRET_LIVE,
  };
}
