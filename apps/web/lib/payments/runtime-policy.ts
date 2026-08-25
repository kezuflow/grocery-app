export type WebPaymentRuntimeEnvironment = {
  ENVIRONMENT?: string;
  PAYMENT_MODE?: string;
};

/**
 * Mirrors the Core containment policy: the compatibility sandbox checkout may
 * run only in an explicit nonproduction environment that opted in through
 * `PAYMENT_MODE=sandbox`. Production and preview must never surface it.
 */
export function isWebSandboxPaymentEnabled(env: WebPaymentRuntimeEnvironment): boolean {
  if (env.PAYMENT_MODE !== "sandbox") return false;
  const environment = env.ENVIRONMENT ?? "development";
  return environment === "development" || environment === "test";
}
