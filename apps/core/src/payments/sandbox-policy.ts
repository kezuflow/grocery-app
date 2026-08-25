export type PaymentRuntimeEnvironment = {
  ENVIRONMENT?: string;
  PAYMENT_MODE?: string;
};

/**
 * Containment guard for the compatibility sandbox payment path. Synthetic
 * payment success may be produced only in an explicit nonproduction
 * environment that also opts in through `PAYMENT_MODE=sandbox`. Every other
 * combination, including production and preview, must fail closed.
 */
export function isSandboxPaymentEnabled(env: PaymentRuntimeEnvironment): boolean {
  if (env.PAYMENT_MODE !== "sandbox") return false;
  const environment = env.ENVIRONMENT ?? "development";
  return environment === "development" || environment === "test";
}
