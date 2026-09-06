import { readBoundedText } from "../../http/bounded-body";
import { log } from "../../observability";
import type { ProviderDeliveryStatus } from "../ports/delivery-provider";

const WEBHOOK_PATH = "/webhooks/delivery/lalamove";
const MAXIMUM_BODY_BYTES = 64 * 1024;

type LalamoveWebhookEnvironment = Readonly<{
  DELIVERY_PROVIDER?: string;
  DELIVERY_PROVIDERS?: string;
  LALAMOVE_API_KEY?: string;
  LALAMOVE_API_SECRET?: string;
}>;

type JsonObject = Record<string, unknown>;
type DispatchRow = {
  id: string;
  merchant_order_id: string;
  version: number;
  provider_observed_at: number | null;
  provider_status_rank: number | null;
};

type LalamoveStatusEvent = Readonly<{
  eventId: string;
  eventType: "ORDER_STATUS_CHANGED";
  orderId: string;
  observedAt: number;
  status: ProviderDeliveryStatus;
  trackingUrl: string | null;
}>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function nonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function providerStatus(value: unknown): ProviderDeliveryStatus | null {
  switch (value) {
    case "ASSIGNING_DRIVER":
      return "ALLOCATING";
    case "ON_GOING":
      return "PENDING_PICKUP";
    case "PICKED_UP":
      return "IN_DELIVERY";
    case "COMPLETED":
      return "COMPLETED";
    case "CANCELED":
      return "CANCELED";
    case "REJECTED":
    case "EXPIRED":
      return "FAILED";
    default:
      return null;
  }
}

function parseStatusEvent(payload: unknown): LalamoveStatusEvent | null {
  const root = object(payload);
  const data = object(root?.data);
  const order = object(data?.order);
  const eventId = nonemptyString(root?.eventId);
  const eventType = nonemptyString(root?.eventType);
  const orderId = nonemptyString(order?.orderId);
  const status = providerStatus(order?.status);
  const updatedAt = nonemptyString(data?.updatedAt);
  const observedAt = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  if (
    !eventId ||
    eventId.length > 128 ||
    eventType !== "ORDER_STATUS_CHANGED" ||
    !orderId ||
    orderId.length > 64 ||
    !status ||
    !Number.isSafeInteger(observedAt)
  )
    return null;
  return {
    eventId,
    eventType,
    orderId,
    observedAt,
    status,
    trackingUrl: nonemptyString(order?.shareLink),
  };
}

function enabled(environment: LalamoveWebhookEnvironment): boolean {
  const configured = environment.DELIVERY_PROVIDERS ?? environment.DELIVERY_PROVIDER ?? "";
  return configured
    .split(",")
    .map((value) => value.trim())
    .includes("lalamove");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function safeEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1)
    difference |= leftBytes[index]! ^ rightBytes[index]!;
  return difference === 0;
}

async function validSignature(
  payload: JsonObject,
  configuredApiKey: string,
  apiSecret: string,
): Promise<boolean> {
  const suppliedKey = nonemptyString(payload.apiKey);
  const timestamp =
    typeof payload.timestamp === "number" && Number.isSafeInteger(payload.timestamp)
      ? String(payload.timestamp)
      : nonemptyString(payload.timestamp);
  const suppliedSignature = nonemptyString(payload.signature);
  if (!suppliedKey || !timestamp || !/^\d+$/.test(timestamp) || !suppliedSignature) return false;
  if (!/^[a-f0-9]{64}$/.test(suppliedSignature)) return false;
  if (!(await safeEqual(configuredApiKey, suppliedKey))) return false;
  const signedBody = JSON.stringify(payload.data);
  const rawSignature = `${timestamp}\r\nPOST\r\n${WEBHOOK_PATH}\r\n\r\n${signedBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureBytes = Uint8Array.from(
    suppliedSignature.match(/.{2}/g)!.map((value) => Number.parseInt(value, 16)),
  );
  return crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(rawSignature));
}

function dispatchStatus(status: ProviderDeliveryStatus) {
  switch (status) {
    case "COMPLETED":
      return "COMPLETED";
    case "CANCELED":
      return "CANCELED";
    case "FAILED":
      return "FAILED";
    default:
      return "ACTIVE";
  }
}

function statusRank(status: ProviderDeliveryStatus): number {
  switch (status) {
    case "ALLOCATING":
      return 10;
    case "PENDING_PICKUP":
      return 20;
    case "IN_DELIVERY":
      return 50;
    case "COMPLETED":
    case "CANCELED":
    case "FAILED":
      return 100;
    default:
      return 0;
  }
}

function json(requestId: string, status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "x-request-id": requestId } });
}

/** Narrow signed Lalamove v3 status ingress. Other event types are retained for reconciliation. */
export async function handleLalamoveWebhook(
  database: D1Database,
  environment: LalamoveWebhookEnvironment,
  request: Request,
  requestId: string,
): Promise<Response> {
  if (new URL(request.url).pathname !== WEBHOOK_PATH || request.method !== "POST")
    return json(requestId, 404, {
      error: { code: "NOT_FOUND", message: "Unknown webhook route", requestId },
    });
  if (!enabled(environment) || !environment.LALAMOVE_API_KEY || !environment.LALAMOVE_API_SECRET)
    return json(requestId, 503, {
      error: {
        code: "DELIVERY_PROVIDER_UNCONFIGURED",
        message: "Delivery provider webhook is unavailable",
        requestId,
      },
    });

  // Lalamove performs an empty-body connection probe when registering a URL.
  if (request.body === null)
    return json(requestId, 200, { ok: true, connectionCheck: true, requestId });

  const body = await readBoundedText(request, {
    maxBytes: MAXIMUM_BODY_BYTES,
    contentTypes: ["application/json"],
  });
  if (!body.ok)
    return json(requestId, body.error.status, {
      error: { code: body.error.code, message: body.error.message, requestId },
    });
  if (body.value.length === 0)
    return json(requestId, 200, { ok: true, connectionCheck: true, requestId });
  let payload: unknown;
  try {
    payload = JSON.parse(body.value) as unknown;
  } catch {
    return json(requestId, 400, {
      error: { code: "MALFORMED_JSON", message: "Request body must contain valid JSON", requestId },
    });
  }
  const root = object(payload);
  if (
    !root ||
    !(await validSignature(
      root,
      environment.LALAMOVE_API_KEY,
      environment.LALAMOVE_API_SECRET,
    ))
  )
    return json(requestId, 401, {
      error: { code: "WEBHOOK_AUTHENTICATION_FAILED", message: "Unauthorized", requestId },
    });

  const parsed = parseStatusEvent(payload);
  const genericEventId = nonemptyString(root.eventId);
  const genericType = nonemptyString(root.eventType);
  const genericData = object(root.data);
  const genericOrder = object(genericData?.order);
  const genericOrderId = nonemptyString(genericOrder?.orderId);
  const genericUpdatedAt = nonemptyString(genericData?.updatedAt);
  const genericObservedAt = genericUpdatedAt ? Date.parse(genericUpdatedAt) : Number.NaN;
  if (
    !genericEventId ||
    genericEventId.length > 128 ||
    !genericType ||
    !genericOrderId ||
    genericOrderId.length > 64 ||
    !Number.isSafeInteger(genericObservedAt)
  )
    return json(requestId, 400, {
      error: { code: "WEBHOOK_EVENT_INVALID", message: "Webhook event is invalid", requestId },
    });

  const dispatch = await database
    .prepare(
      `SELECT id, merchant_order_id, version, provider_observed_at, provider_status_rank
       FROM delivery_provider_dispatch
       WHERE provider='lalamove' AND provider_delivery_id=?`,
    )
    .bind(genericOrderId)
    .first<DispatchRow>();
  const payloadHash = await sha256(body.value);
  const inboxId = `lalamove-event:${genericEventId}`;
  const receivedAt = Date.now();
  const canApply = Boolean(dispatch && parsed);
  const inserted = await database
    .prepare(
      `INSERT OR IGNORE INTO delivery_provider_event_inbox
       (id, provider, provider_event_id, dispatch_id, provider_delivery_id,
        merchant_order_id, observed_at, provider_status, payload_hash, raw_payload,
        processing_status, last_error_code, received_at)
       VALUES (?, 'lalamove', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      inboxId,
      genericEventId,
      dispatch?.id ?? null,
      genericOrderId,
      dispatch?.merchant_order_id ?? "UNKNOWN",
      genericObservedAt,
      parsed?.status ?? genericType,
      payloadHash,
      body.value,
      canApply ? "RECEIVED" : "RECONCILIATION_REQUIRED",
      dispatch
        ? parsed
          ? null
          : "LALAMOVE_EVENT_REQUIRES_RECONCILIATION"
        : "DELIVERY_DISPATCH_NOT_FOUND",
      receivedAt,
    )
    .run();
  if ((inserted.meta?.changes ?? 0) !== 1)
    return json(requestId, 200, { ok: true, duplicate: true, requestId });
  if (!dispatch || !parsed) {
    log("warn", "delivery_provider_webhook", {
      requestId,
      provider: "lalamove",
      result: "RECONCILIATION_REQUIRED",
      eventType: genericType,
    });
    return json(requestId, 200, { ok: true, reconciliationRequired: true, requestId });
  }

  const rank = statusRank(parsed.status);
  const updated = await database
    .prepare(
      `UPDATE delivery_provider_dispatch
       SET status=?, provider_status=?, provider_observed_at=?, provider_status_rank=?,
           tracking_url=COALESCE(?, tracking_url), last_error_code=?,
           version=version+1, updated_at=?
       WHERE id=? AND version=?
         AND (
           provider_observed_at IS NULL OR provider_observed_at < ?
           OR (provider_observed_at = ? AND provider_status_rank < ?)
         )`,
    )
    .bind(
      dispatchStatus(parsed.status),
      parsed.status,
      parsed.observedAt,
      rank,
      parsed.trackingUrl,
      parsed.status === "FAILED" ? "LALAMOVE_DELIVERY_FAILED" : null,
      receivedAt,
      dispatch.id,
      dispatch.version,
      parsed.observedAt,
      parsed.observedAt,
      rank,
    )
    .run();
  if ((updated.meta?.changes ?? 0) !== 1) {
    const latest = await database
      .prepare(
        `SELECT version, provider_observed_at, provider_status_rank
         FROM delivery_provider_dispatch WHERE id=?`,
      )
      .bind(dispatch.id)
      .first<Pick<DispatchRow, "version" | "provider_observed_at" | "provider_status_rank">>();
    const older =
      latest !== null &&
      latest.version === dispatch.version &&
      latest.provider_observed_at !== null &&
      (latest.provider_observed_at > parsed.observedAt ||
        (latest.provider_observed_at === parsed.observedAt &&
          (latest.provider_status_rank ?? 0) >= rank));
    await database
      .prepare(
        `UPDATE delivery_provider_event_inbox
         SET processing_status=?, processed_at=?, last_error_code=? WHERE id=?`,
      )
      .bind(
        older ? "APPLIED" : "RECONCILIATION_REQUIRED",
        older ? Date.now() : null,
        older ? null : "DELIVERY_DISPATCH_STALE",
        inboxId,
      )
      .run();
    return json(requestId, older ? 200 : 202, {
      ok: true,
      ...(older ? { ignoredAsOlder: true } : { reconciliationRequired: true }),
      requestId,
    });
  }
  await database
    .prepare(
      `UPDATE delivery_provider_event_inbox
       SET processing_status='APPLIED', processed_at=?, last_error_code=NULL WHERE id=?`,
    )
    .bind(Date.now(), inboxId)
    .run();
  log("info", "delivery_provider_webhook", {
    requestId,
    provider: "lalamove",
    result: "APPLIED",
    providerStatus: parsed.status,
  });
  return json(requestId, 200, { ok: true, duplicate: false, requestId });
}
