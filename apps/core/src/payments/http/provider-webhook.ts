import { ingestProviderEvent } from "../application/ingest-provider-event";
import type { PaymentProviderRegistry } from "../ports/provider-registry";
import { readBoundedText } from "../../http/bounded-body";

const WEBHOOK_PATH = /^\/webhooks\/payments\/([a-z0-9_-]+)$/;
export const PAYMENT_WEBHOOK_MAX_BYTES = 256 * 1024;

/**
 * Narrow signed provider-event ingress. The route exists only for adapters
 * that verify signatures before trusting content; Core composes the registry
 * from environment configuration, so with no production adapter selected every
 * webhook request fails closed as PAYMENT_PROVIDER_UNCONFIGURED.
 */
export async function handleProviderWebhook(
  database: D1Database,
  registry: PaymentProviderRegistry,
  request: Request,
  requestId: string,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const match = WEBHOOK_PATH.exec(path);
  if (!match || request.method !== "POST") {
    return webhookJson(
      { error: { code: "NOT_FOUND", message: "Unknown webhook route", requestId } },
      requestId,
      404,
    );
  }
  const body = await readBoundedText(request, {
    maxBytes: PAYMENT_WEBHOOK_MAX_BYTES,
    contentTypes: ["application/json"],
  });
  if (!body.ok) {
    return webhookJson(
      { ok: false, error: { ...body.error, requestId } },
      requestId,
      body.error.status,
    );
  }
  const outcome = await ingestProviderEvent(
    database,
    registry,
    match[1],
    request.headers,
    body.value,
    requestId,
  );
  if (!outcome.ok) {
    const status =
      outcome.error.code === "PAYMENT_PROVIDER_UNCONFIGURED"
        ? 503
        : outcome.error.code === "WEBHOOK_VERIFICATION_FAILED"
          ? 400
          : 500;
    return webhookJson({ ok: false, error: outcome.error }, requestId, status);
  }
  const status =
    outcome.value.processingStatus === "RETRY_REQUIRED"
      ? 202
      : outcome.value.processingStatus === "REJECTED"
        ? 400
        : 200;
  return webhookJson({ ok: true, value: outcome.value, requestId }, requestId, status);
}

function webhookJson(body: unknown, requestId: string, status: number): Response {
  return Response.json(body, { status, headers: { "x-request-id": requestId } });
}
