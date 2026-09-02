import { createMockPaymentProvider } from "./mock-payment-provider";
import { createPayMongoPaymentProvider } from "./paymongo-payment-provider";
import { ProviderRegistry } from "./provider-registry";
import type { CoreRuntimeConfiguration } from "../../../runtime/runtime-configuration";
import { parseRuntimeEnvironment } from "../../../runtime/runtime-configuration";

export type RuntimePaymentsEnvironment = {
  ENVIRONMENT?: string;
  PAYMENT_PROVIDER?: string;
  PAYMONGO_SECRET_KEY?: string;
  PAYMONGO_WEBHOOK_SECRET?: string;
};

export function selectedPaymentProviderCode(
  environment: RuntimePaymentsEnvironment | CoreRuntimeConfiguration,
): string | null {
  if ("payments" in environment) return environment.payments.providerCode;
  const runtimeEnvironment = parseRuntimeEnvironment(environment.ENVIRONMENT);
  if (!environment.PAYMENT_PROVIDER || environment.PAYMENT_PROVIDER === "disabled") return null;
  if (environment.PAYMENT_PROVIDER === "paymongo") {
    if (!environment.PAYMONGO_SECRET_KEY) throw new Error("PAYMONGO_SECRET_KEY_REQUIRED");
    if (!environment.PAYMONGO_WEBHOOK_SECRET) throw new Error("PAYMONGO_WEBHOOK_SECRET_REQUIRED");
    return "paymongo";
  }
  if (environment.PAYMENT_PROVIDER !== "mock") throw new Error("PAYMENT_PROVIDER_INVALID");
  if (runtimeEnvironment !== "development" && runtimeEnvironment !== "test")
    throw new Error("MOCK_PAYMENT_PROVIDER_FORBIDDEN");
  return "mock";
}

/**
 * The single runtime construction point. Provider selection is explicit
 * configuration, never registration order. Only the deterministic mock is
 * approved for the current release and only in development/test; every other combination
 * yields an empty registry and therefore fails closed.
 */
export function buildProviderRegistry(
  environment: RuntimePaymentsEnvironment | CoreRuntimeConfiguration,
): ProviderRegistry {
  const runtimeEnvironment =
    "environment" in environment
      ? environment.environment
      : parseRuntimeEnvironment(environment.ENVIRONMENT);
  const registry = new ProviderRegistry(runtimeEnvironment);
  if (selectedPaymentProviderCode(environment) === "mock")
    registry.register(createMockPaymentProvider(), runtimeEnvironment);
  if (selectedPaymentProviderCode(environment) === "paymongo") {
    const paymongo =
      "payments" in environment
        ? environment.payments.paymongo
        : environment.PAYMONGO_SECRET_KEY && environment.PAYMONGO_WEBHOOK_SECRET
          ? {
              secretKey: environment.PAYMONGO_SECRET_KEY,
              webhookSecret: environment.PAYMONGO_WEBHOOK_SECRET,
            }
          : null;
    if (!paymongo) throw new Error("PAYMONGO_CONFIGURATION_REQUIRED");
    registry.register(createPayMongoPaymentProvider(paymongo), runtimeEnvironment);
  }
  return registry;
}
