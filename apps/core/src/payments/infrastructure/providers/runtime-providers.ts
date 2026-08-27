import { createMockPaymentProvider } from "./mock-payment-provider";
import { ProviderRegistry } from "./provider-registry";

export type RuntimePaymentsEnvironment = {
  ENVIRONMENT?: string;
  PAYMENT_PROVIDER?: string;
};

export function selectedPaymentProviderCode(
  environment: RuntimePaymentsEnvironment,
): string | null {
  return environment.PAYMENT_PROVIDER === "mock" &&
    (environment.ENVIRONMENT === "development" || environment.ENVIRONMENT === "test")
    ? "mock"
    : null;
}

/**
 * The single runtime construction point. Provider selection is explicit
 * configuration, never registration order. Only the deterministic mock is
 * approved for this MVP and only in development/test; every other combination
 * yields an empty registry and therefore fails closed.
 */
export function buildProviderRegistry(environment: RuntimePaymentsEnvironment): ProviderRegistry {
  const registry = new ProviderRegistry(environment.ENVIRONMENT);
  if (selectedPaymentProviderCode(environment) === "mock")
    registry.register(createMockPaymentProvider(), environment.ENVIRONMENT);
  return registry;
}
