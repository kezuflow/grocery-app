import { log } from "../../observability";
import { readBoundedText } from "../../http/bounded-body";
import type { ProviderDeliveryStatus } from "../ports/delivery-provider";

const WEBHOOK_PATH = "/webhooks/delivery/grab-express";
const MAXIMUM_BODY_BYTES = 64 * 1024;

type GrabWebhookEnvironment = Readonly<{
  DELIVERY_PROVIDER?: string;
  GRAB_EXPRESS_WEBHOOK_CLIENT_ID?: string;
  GRAB_EXPRESS_WEBHOOK_SECRET?: string;
}>;

type JsonObject = Record<string, unknown>;

type GrabEvent = Readonly<{
  deliveryId: string;
  merchantOrderId: string;
  observedAt: number;
  status: ProviderDeliveryStatus;
  trackingUrl: string | null;
  pickupPin: string | null;
  failedReason: string | null;
}>;

type DispatchRow = {
  id: string;
  version: number;
  provider_observed_at: number | null;
  provider_status_rank: number | null;
};

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function nonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function status(value: unknown): ProviderDeliveryStatus | null {
  switch (value) {
    case "ALLOCATING":
    case "PENDING_PICKUP":
    case "PICKING_UP":
    case "PENDING_DROP_OFF":
    case "IN_DELIVERY":
    case "IN_RETURN":
    case "COMPLETED":
    case "CANCELED":
    case "RETURNED":
    case "FAILED":
      return value;
    default:
      return null;
  }
}

function event(payload: unknown): GrabEvent | null {
  const value = object(payload);
  const deliveryId = nonemptyString(value?.deliveryID);
  const merchantOrderId = nonemptyString(value?.merchantOrderID);
  const observedAtSeconds = value?.timestamp;
  const providerStatus = status(value?.status);
  const observedAt = typeof observedAtSeconds === "number" ? observedAtSeconds * 1_000 : Number.NaN;
  if (
    !deliveryId ||
    deliveryId.length > 64 ||
    !merchantOrderId ||
    merchantOrderId.length > 64 ||
    typeof observedAtSeconds !== "number" ||
    !Number.isSafeInteger(observedAtSeconds) ||
    observedAtSeconds < 0 ||
    !Number.isSafeInteger(observedAt) ||
    !providerStatus
  )
    return null;
  const failedReason = nullableString(value?.failedReason);
  if (providerStatus !== "FAILED" && failedReason) return null;
  return {
    deliveryId,
    merchantOrderId,
    observedAt,
    status: providerStatus,
    trackingUrl: nullableString(value?.trackURL),
    pickupPin: nullableString(value?.pickupPin),
    failedReason,
  };
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

function dispatchStatus(providerStatus: ProviderDeliveryStatus) {
  switch (providerStatus) {
    case "COMPLETED":
      return "COMPLETED";
    case "CANCELED":
      return "CANCELED";
    case "RETURNED":
      return "RETURNED";
    case "FAILED":
      return "FAILED";
    default:
      return "ACTIVE";
  }
}

function providerStatusRank(providerStatus: ProviderDeliveryStatus): number {
  switch (providerStatus) {
    case "ALLOCATING":
      return 10;
    case "PENDING_PICKUP":
      return 20;
    case "PICKING_UP":
      return 30;
    case "PENDING_DROP_OFF":
      return 40;
    case "IN_DELIVERY":
      return 50;
    case "IN_RETURN":
      return 60;
    case "COMPLETED":
    case "CANCELED":
    case "RETURNED":
    case "FAILED":
      return 100;
    default:
      return 0;
  }
}

function json(requestId: string, statusCode: number, body: unknown): Response {
  return Response.json(body, {
    status: statusCode,
    headers: { "x-request-id": requestId },
  });
}

/** Narrow authenticated GrabExpress status ingress. */
export async function handleGrabExpressWebhook(
  database: D1Database,
  environment: GrabWebhookEnvironment,
  request: Request,
  requestId: string,
): Promise<Response> {
  if (new URL(request.url).pathname !== WEBHOOK_PATH || request.method !== "POST")
    return json(requestId, 404, {
      error: { code: "NOT_FOUND", message: "Unknown webhook route", requestId },
    });
  if (
    environment.DELIVERY_PROVIDER !== "grab-express" ||
    !environment.GRAB_EXPRESS_WEBHOOK_CLIENT_ID ||
    !environment.GRAB_EXPRESS_WEBHOOK_SECRET
  )
    return json(requestId, 503, {
      error: {
        code: "DELIVERY_PROVIDER_UNCONFIGURED",
        message: "Delivery provider webhook is unavailable",
        requestId,
      },
    });
  const suppliedClientId = request.headers.get("authorization-id") ?? "";
  const suppliedSecret = request.headers.get("authorization") ?? "";
  const [clientIdMatches, secretMatches] = await Promise.all([
    safeEqual(environment.GRAB_EXPRESS_WEBHOOK_CLIENT_ID, suppliedClientId),
    safeEqual(environment.GRAB_EXPRESS_WEBHOOK_SECRET, suppliedSecret),
  ]);
  const authenticated = clientIdMatches && secretMatches;
  if (!authenticated)
    return json(requestId, 401, {
      error: { code: "WEBHOOK_AUTHENTICATION_FAILED", message: "Unauthorized", requestId },
    });

  const body = await readBoundedText(request, {
    maxBytes: MAXIMUM_BODY_BYTES,
    contentTypes: ["application/json"],
  });
  if (!body.ok)
    return json(requestId, body.error.status, {
      error: { code: body.error.code, message: body.error.message, requestId },
    });
  let payload: unknown;
  try {
    payload = JSON.parse(body.value) as unknown;
  } catch {
    return json(requestId, 400, {
      error: { code: "MALFORMED_JSON", message: "Request body must contain valid JSON", requestId },
    });
  }
  const parsed = event(payload);
  if (!parsed)
    return json(requestId, 400, {
      error: { code: "WEBHOOK_EVENT_INVALID", message: "Webhook event is invalid", requestId },
    });

  const payloadHash = await sha256(body.value);
  const providerEventId = await sha256(
    JSON.stringify([
      parsed.deliveryId,
      parsed.merchantOrderId,
      parsed.observedAt,
      parsed.status,
      parsed.failedReason,
    ]),
  );
  const dispatch = await database
    .prepare(
      `SELECT id, version, provider_observed_at, provider_status_rank
       FROM delivery_provider_dispatch
       WHERE provider='grab-express' AND provider_delivery_id=? AND merchant_order_id=?`,
    )
    .bind(parsed.deliveryId, parsed.merchantOrderId)
    .first<DispatchRow>();
  const inboxId = `grab-event:${providerEventId}`;
  const receivedAt = Date.now();
  const inserted = await database
    .prepare(
      `INSERT OR IGNORE INTO delivery_provider_event_inbox
       (id, provider, provider_event_id, dispatch_id, provider_delivery_id,
        merchant_order_id, observed_at, provider_status, payload_hash, raw_payload,
        processing_status, last_error_code, received_at)
       VALUES (?, 'grab-express', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      inboxId,
      providerEventId,
      dispatch?.id ?? null,
      parsed.deliveryId,
      parsed.merchantOrderId,
      parsed.observedAt,
      parsed.status,
      payloadHash,
      body.value,
      dispatch ? "RECEIVED" : "RECONCILIATION_REQUIRED",
      dispatch ? null : "DELIVERY_DISPATCH_NOT_FOUND",
      receivedAt,
    )
    .run();
  if ((inserted.meta?.changes ?? 0) !== 1)
    return json(requestId, 200, { ok: true, duplicate: true, requestId });
  if (!dispatch) {
    log("warn", "delivery_provider_webhook", {
      requestId,
      provider: "grab-express",
      result: "RECONCILIATION_REQUIRED",
      errorCode: "DELIVERY_DISPATCH_NOT_FOUND",
    });
    return json(requestId, 202, { ok: true, reconciliationRequired: true, requestId });
  }

  const updated = await database
    .prepare(
      `UPDATE delivery_provider_dispatch
       SET status=?, provider_status=?, provider_observed_at=?, provider_status_rank=?,
           tracking_url=COALESCE(?, tracking_url),
           pickup_pin=COALESCE(?, pickup_pin), last_error_code=?,
           version=version+1, updated_at=?
       WHERE id=? AND version=?
         AND (
           provider_observed_at IS NULL
           OR provider_observed_at < ?
           OR (provider_observed_at = ? AND provider_status_rank < ?)
         )`,
    )
    .bind(
      dispatchStatus(parsed.status),
      parsed.status,
      parsed.observedAt,
      providerStatusRank(parsed.status),
      parsed.trackingUrl,
      parsed.pickupPin,
      parsed.status === "FAILED" ? "GRAB_DELIVERY_FAILED" : null,
      receivedAt,
      dispatch.id,
      dispatch.version,
      parsed.observedAt,
      parsed.observedAt,
      providerStatusRank(parsed.status),
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
    const incomingRank = providerStatusRank(parsed.status);
    const isOlderObservation =
      latest !== null &&
      latest.version === dispatch.version &&
      latest.provider_observed_at !== null &&
      (latest.provider_observed_at > parsed.observedAt ||
        (latest.provider_observed_at === parsed.observedAt &&
          (latest.provider_status_rank ?? 0) >= incomingRank));
    if (isOlderObservation) {
      await database
        .prepare(
          `UPDATE delivery_provider_event_inbox
           SET processing_status='APPLIED', processed_at=?, last_error_code=NULL
           WHERE id=? AND processing_status='RECEIVED'`,
        )
        .bind(Date.now(), inboxId)
        .run();
      return json(requestId, 200, { ok: true, duplicate: false, ignoredAsOlder: true, requestId });
    }
    await database
      .prepare(
        `UPDATE delivery_provider_event_inbox
         SET processing_status='RECONCILIATION_REQUIRED',
             last_error_code='DELIVERY_DISPATCH_STALE'
         WHERE id=? AND processing_status='RECEIVED'`,
      )
      .bind(inboxId)
      .run();
    return json(requestId, 202, { ok: true, reconciliationRequired: true, requestId });
  }
  await database
    .prepare(
      `UPDATE delivery_provider_event_inbox
       SET processing_status='APPLIED', processed_at=?, last_error_code=NULL
       WHERE id=? AND processing_status='RECEIVED'`,
    )
    .bind(Date.now(), inboxId)
    .run();
  log("info", "delivery_provider_webhook", {
    requestId,
    provider: "grab-express",
    result: "APPLIED",
    providerStatus: parsed.status,
  });
  return json(requestId, 200, { ok: true, duplicate: false, requestId });
}
