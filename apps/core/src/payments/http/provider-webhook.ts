import { ingestProviderEvent } from "../application/ingest-provider-event";
import type { ProviderRegistry } from "../infrastructure/providers/provider-registry";

const WEBHOOK_PATH = /^\/webhooks\/payments\/([a-z0-9_-]+)$/;

/**
 * Narrow signed provider-event ingress. The route exists only for adapters
 * that verify signatures before trusting content; Core composes the registry
 * from environment configuration, so with no production adapter selected every
 * webhook request fails closed as PAYMENT_PROVIDER_UNCONFIGURED.
 */
export async function handleProviderWebhook(
  database: D1Database,
  registry: ProviderRegistry,
  request: Request,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const match = WEBHOOK_PATH.exec(path);
  if (!match || request.method !== "POST") {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Unknown webhook route" } },
      { status: 404 },
    );
  }
  const rawBody = await request.text();
  const outcome = await ingestProviderEvent(database, registry, match[1], request.headers, rawBody);
  if (!outcome.ok) {
    const status =
      outcome.error.code === "PAYMENT_PROVIDER_UNCONFIGURED"
        ? 503
        : outcome.error.code === "WEBHOOK_VERIFICATION_FAILED"
          ? 400
          : 500;
    return Response.json({ ok: false, error: outcome.error }, { status });
  }
  const status =
    outcome.value.processingStatus === "RETRY_REQUIRED"
      ? 202
      : outcome.value.processingStatus === "REJECTED"
        ? 400
        : 200;
  return Response.json({ ok: true, value: outcome.value }, { status });
}
