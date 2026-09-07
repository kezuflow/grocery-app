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

function deliveryJobStatus(status: ProviderDeliveryStatus): string | null {
  switch (status) {
    case "ALLOCATING":
    case "PENDING_PICKUP":
    case "PICKING_UP":
    case "PENDING_DROP_OFF":
      return "ASSIGNED";
    case "IN_DELIVERY":
      return "EN_ROUTE";
    case "COMPLETED":
      return "DELIVERED";
    case "CANCELED":
    case "FAILED":
    case "IN_RETURN":
    case "RETURNED":
      return "FAILED";
    default:
      return null;
  }
}

function projectedOrderStatus(jobStatus: string): string | null {
  switch (jobStatus) {
    case "EN_ROUTE":
      return "OUT_FOR_DELIVERY";
    case "DELIVERED":
      return "DELIVERED";
    case "FAILED":
    case "CANCELED":
      return null;
    default:
      return null;
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
    !(await validSignature(root, environment.LALAMOVE_API_KEY, environment.LALAMOVE_API_SECRET))
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
  if ((inserted.meta?.changes ?? 0) !== 1) {
    const existing = await database
      .prepare(`SELECT processing_status,provider_delivery_id,observed_at,provider_status
      FROM delivery_provider_event_inbox WHERE id=?`)
      .bind(inboxId)
      .first<{
        processing_status: string;
        provider_delivery_id: string;
        observed_at: number;
        provider_status: string;
      }>();
    if (
      !existing ||
      existing.provider_delivery_id !== genericOrderId ||
      existing.observed_at !== genericObservedAt ||
      existing.provider_status !== (parsed?.status ?? genericType)
    )
      return json(requestId, 409, {
        error: {
          code: "WEBHOOK_EVENT_CONFLICT",
          message: "Event identity was already used for different evidence",
          requestId,
        },
      });
    if (existing.processing_status === "APPLIED")
      return json(requestId, 200, { ok: true, duplicate: true, requestId });
  }
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
  const older =
    dispatch.provider_observed_at !== null &&
    (dispatch.provider_observed_at > parsed.observedAt ||
      (dispatch.provider_observed_at === parsed.observedAt &&
        (dispatch.provider_status_rank ?? 0) >= rank));
  if (older) {
    await database
      .prepare(`UPDATE delivery_provider_event_inbox SET processing_status='APPLIED',processed_at=?,last_error_code=NULL,
      dispatch_id=?,merchant_order_id=? WHERE id=?`)
      .bind(receivedAt, dispatch.id, dispatch.merchant_order_id, inboxId)
      .run();
    return json(requestId, 200, { ok: true, ignoredAsOlder: true, requestId });
  }
  const updateDispatch = database
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
    );
  const normalizedStatus = deliveryJobStatus(parsed.status);
  // Courier cancellation is a visible delivery failure, never authority to
  // cancel or otherwise mutate the customer's paid grocery commitment.
  const orderStatus =
    normalizedStatus && parsed.status !== "CANCELED"
      ? projectedOrderStatus(normalizedStatus)
      : null;
  const appliedAt = Date.now();
  const requiresPacked = normalizedStatus === "EN_ROUTE" || normalizedStatus === "DELIVERED";
  const packedOrderSql = `SELECT 1 FROM delivery_provider_dispatch dispatch
    JOIN delivery_job job ON job.id=dispatch.delivery_job_id
    JOIN fulfillment_record fulfillment ON fulfillment.order_id=job.order_id
    JOIN grocery_order grocery ON grocery.id=job.order_id
    WHERE dispatch.id=? AND fulfillment.status IN ('PACKED','HANDED_OFF','COMPLETED')
      AND grocery.status IN ('FULFILLMENT_READY','OUT_FOR_DELIVERY','DELIVERED')`;
  if (requiresPacked && !(await database.prepare(packedOrderSql).bind(dispatch.id).first())) {
    await database
      .prepare(`UPDATE delivery_provider_event_inbox SET processing_status='RECONCILIATION_REQUIRED',
      last_error_code='DELIVERY_PACKING_NOT_COMPLETE',dispatch_id=?,merchant_order_id=? WHERE id=? AND processing_status!='APPLIED'`)
      .bind(dispatch.id, dispatch.merchant_order_id, inboxId)
      .run();
    return json(requestId, 202, { ok: true, reconciliationRequired: true, requestId });
  }
  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (SELECT 1 FROM delivery_provider_event_inbox WHERE id=? AND processing_status!='APPLIED')",
      )
      .bind(inboxId),
    updateDispatch,
    database.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
  ];
  if (requiresPacked)
    statements.push(
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (${packedOrderSql})`)
        .bind(dispatch.id),
    );
  if (normalizedStatus) {
    statements.push(
      database
        .prepare(
          `UPDATE delivery_job SET status=?,delivered_at=?,version=version+1,updated_at=?
           WHERE id=(SELECT delivery_job_id FROM delivery_provider_dispatch WHERE id=?)
             AND status NOT IN ('DELIVERED','CANCELED','ESCALATED')`,
        )
        .bind(
          normalizedStatus,
          normalizedStatus === "DELIVERED" ? appliedAt : null,
          appliedAt,
          dispatch.id,
        ),
      database
        .prepare(
          `UPDATE delivery_stop SET status=?,delivered_at=?,version=version+1,updated_at=?
           WHERE delivery_job_id=(SELECT delivery_job_id FROM delivery_provider_dispatch WHERE id=?)
             AND status NOT IN ('DELIVERED','CANCELED','ESCALATED')`,
        )
        .bind(
          normalizedStatus,
          normalizedStatus === "DELIVERED" ? appliedAt : null,
          appliedAt,
          dispatch.id,
        ),
    );
  }
  if (orderStatus) {
    statements.push(
      database
        .prepare(
          `UPDATE grocery_order SET status=?,version=version+1
           WHERE id=(SELECT job.order_id FROM delivery_provider_dispatch dispatch JOIN delivery_job job ON job.id=dispatch.delivery_job_id WHERE dispatch.id=?)
             AND status IN ('FULFILLMENT_READY','OUT_FOR_DELIVERY') AND status!=?`,
        )
        .bind(orderStatus, dispatch.id, orderStatus),
    );
  }
  statements.push(
    database
      .prepare(`UPDATE delivery_provider_event_inbox
    SET processing_status='APPLIED',processed_at=?,last_error_code=NULL,dispatch_id=?,merchant_order_id=? WHERE id=?`)
      .bind(appliedAt, dispatch.id, dispatch.merchant_order_id, inboxId),
  );
  try {
    await database.batch(statements);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("CHECK constraint failed: id = 0"))
      throw error;
    const applied = await database
      .prepare(
        "SELECT id FROM delivery_provider_event_inbox WHERE id=? AND processing_status='APPLIED'",
      )
      .bind(inboxId)
      .first();
    if (applied) return json(requestId, 200, { ok: true, duplicate: true, requestId });
    await database
      .prepare(`UPDATE delivery_provider_event_inbox SET processing_status='RECONCILIATION_REQUIRED',last_error_code='DELIVERY_DISPATCH_STALE'
      WHERE id=? AND processing_status!='APPLIED'`)
      .bind(inboxId)
      .run();
    return json(requestId, 202, { ok: true, reconciliationRequired: true, requestId });
  }
  log("info", "delivery_provider_webhook", {
    requestId,
    provider: "lalamove",
    result: "APPLIED",
    providerStatus: parsed.status,
  });
  return json(requestId, 200, { ok: true, duplicate: false, requestId });
}
