import { z } from "zod";
import type { MobileEnvironment } from "./environment";

const healthSchema = z.object({
  service: z.literal("core"),
  status: z.literal("ok"),
  environment: z.string(),
  contractVersion: z.string().min(1),
  databaseBindingConfigured: z.literal(true),
});
export type BackendState = { kind: "loading" } | { kind: "available" } | { kind: "unavailable" };

export async function readBackend(
  environment: MobileEnvironment,
  signal: AbortSignal,
): Promise<BackendState> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort);
  if (signal.aborted) controller.abort();
  const timeout = setTimeout(abort, 5000);
  try {
    const response = await fetch(`${environment.backendOrigin}/api/core-health`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      credentials: "omit",
    });
    if (!response.ok) return { kind: "unavailable" };
    const health = healthSchema.parse(await response.json());
    if (
      health.environment !== (environment.variant === "development" ? "development" : "staging")
    ) {
      return { kind: "unavailable" };
    }
    return { kind: "available" };
  } catch {
    return { kind: "unavailable" };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
