import {
  CONTRACT_VERSION,
  type CoreHealthResponse,
  type CoreReadinessResponse,
} from "@freshmarkets/contracts";
import {
  buildProviderRegistry,
  selectedPaymentProviderCode,
} from "../payments/infrastructure/providers/runtime-providers";
import { coreRuntimeConfiguration } from "./runtime-configuration";

export function buildHealthResponse(env: Env): CoreHealthResponse {
  const configuredEnvironment = env.ENVIRONMENT as string | undefined;
  const environment =
    configuredEnvironment === "test" ? "development" : (configuredEnvironment ?? "unknown");
  return {
    service: "core",
    status: "ok",
    contractVersion: CONTRACT_VERSION,
    environment,
    databaseBindingConfigured: Boolean(env.DB),
    timestamp: new Date().toISOString(),
  };
}

export async function buildReadinessResponse(env: Env): Promise<CoreReadinessResponse> {
  let environment: string = env.ENVIRONMENT ?? "unconfigured";
  let runtimeConfiguration: "ready" | "not_ready" = "not_ready";
  let paymentProvider: CoreReadinessResponse["checks"]["paymentProvider"] = {
    status: "not_ready",
    code: null,
    capabilities: [],
  };
  try {
    const runtime = coreRuntimeConfiguration(env);
    environment = runtime.environment === "test" ? "development" : runtime.environment;
    runtimeConfiguration = "ready";
    const code = selectedPaymentProviderCode(runtime);
    const provider = code ? buildProviderRegistry(runtime).get(code) : null;
    paymentProvider = {
      status: provider ? "ready" : "not_ready",
      code: provider?.code ?? null,
      capabilities: provider
        ? [
            "PAYMENT_CREATE",
            "RECURRING_AUTHORIZATION",
            "WEBHOOK_VERIFICATION",
            "PAYMENT_LOOKUP",
            "REFUND_REQUEST",
          ]
        : [],
    };
  } catch {
    // Readiness is a safe deployment signal. Configuration details stay in
    // controlled startup/deployment logs and never cross this public DTO.
  }

  let database: "ready" | "not_ready" = "not_ready";
  try {
    if (env.DB) {
      const probe = await env.DB.prepare("SELECT 1 AS ready").first<{ ready: number }>();
      if (probe?.ready === 1) database = "ready";
    }
  } catch {
    // Do not expose provider errors, database identifiers, or query details.
  }

  const checks = { runtimeConfiguration, database, paymentProvider } as const;
  return {
    service: "core",
    status:
      runtimeConfiguration === "ready" && database === "ready" && paymentProvider.status === "ready"
        ? "ready"
        : "not_ready",
    contractVersion: CONTRACT_VERSION,
    environment,
    checks,
    timestamp: new Date().toISOString(),
  };
}
