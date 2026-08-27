export type MockPaymentRuntimeEnvironment = {
  ENVIRONMENT?: string;
  PAYMENT_PROVIDER?: string;
};

/**
 * Containment guard for the deterministic mock payment path. It is available
 * only when both the environment and provider selection are explicit.
 */
export function isMockPaymentEnabled(env: MockPaymentRuntimeEnvironment): boolean {
  if (env.PAYMENT_PROVIDER !== "mock") return false;
  const environment = env.ENVIRONMENT;
  return environment === "development" || environment === "test";
}
