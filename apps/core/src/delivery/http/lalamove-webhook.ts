import { applyProviderEvent } from "../application/apply-provider-event";
import { parseLalamoveEvent } from "../infrastructure/lalamove/lalamove-event";
import { readBoundedText } from "../../http/bounded-body";
import { log } from "../../observability";

const WEBHOOK_PATH = "/webhooks/delivery/lalamove";
const MAXIMUM_BODY_BYTES = 64 * 1024;

type LalamoveWebhookEnvironment = Readonly<{
  DELIVERY_PROVIDER?: string;
  DELIVERY_PROVIDERS?: string;
  LALAMOVE_API_KEY?: string;
  LALAMOVE_API_SECRET?: string;
}>;

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function nonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
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

function json(requestId: string, status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "x-request-id": requestId } });
}

/** Signed Lalamove v3 event ingress with protected evidence and durable replay. */
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
    allowEmptyWithoutContentType: true,
  });
  if (!body.ok)
    return json(requestId, body.error.status, {
      error: { code: body.error.code, message: body.error.message, requestId },
    });
  // The Partner Portal currently sends `{}` for its connection check even though
  // the webhook tutorial describes an empty body.
  if (body.value.length === 0 || body.value === "{}")
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

  let parsed = parseLalamoveEvent(payload);
  if (!parsed)
    return json(requestId, 400, {
      error: { code: "WEBHOOK_EVENT_INVALID", message: "Webhook event is invalid", requestId },
    });
  // Retry signatures/timestamps can differ. Compare the complete signed evidence
  // and envelope semantics, not the transport authentication fields.
  const payloadHash = await sha256(
    JSON.stringify({ eventType: root.eventType, eventVersion: root.eventVersion, data: root.data }),
  );
  // Actual PH sandbox sends STATUS_CHANGED and DRIVER_ASSIGNED with the same
  // eventId. Type is part of delivery identity; different facts within one
  // type still conflict. Preserve matching retained rows and their references.
  const legacy = await database
    .prepare(
      "SELECT id,raw_payload FROM delivery_provider_event_inbox WHERE provider='lalamove' AND provider_event_id=?",
    )
    .bind(parsed.eventId)
    .first<{ id: string; raw_payload: string }>();
  const legacyPayload = legacy ? object(JSON.parse(legacy.raw_payload)) : null;
  const matchingLegacy =
    legacyPayload?.eventId === parsed.eventId && legacyPayload?.eventType === root.eventType;
  const eventIdentity = matchingLegacy
    ? parsed.eventId
    : JSON.stringify([root.eventType, parsed.eventId]);
  const inboxId =
    matchingLegacy && legacy ? legacy.id : `lalamove-event:${await sha256(eventIdentity)}`;
  const inserted = await database
    .prepare(`INSERT OR IGNORE INTO delivery_provider_event_inbox
    (id,provider,provider_event_id,provider_delivery_id,merchant_order_id,observed_at,provider_status,payload_hash,raw_payload,normalized_event_json,processing_status,received_at)
    VALUES (?,'lalamove',?,?,'UNKNOWN',?,?,?,?,?,'RECEIVED',?)`)
    .bind(
      inboxId,
      eventIdentity,
      parsed.providerDeliveryId ?? "WALLET",
      parsed.observedAt,
      parsed.status ?? String(root.eventType),
      payloadHash,
      body.value,
      JSON.stringify(parsed),
      Date.now(),
    )
    .run();
  if (inserted.meta.changes !== 1) {
    const existing = await database
      .prepare(
        `SELECT processing_status,payload_hash,raw_payload FROM delivery_provider_event_inbox WHERE id=?`,
      )
      .bind(inboxId)
      .first<{ processing_status: string; payload_hash: string; raw_payload: string }>();
    // Support inbox rows written before the normalized fingerprint migration.
    let existingHash = existing?.payload_hash;
    if (existing && existingHash !== payloadHash) {
      const old = object(JSON.parse(existing.raw_payload));
      existingHash = await sha256(
        JSON.stringify({
          eventType: old?.eventType,
          eventVersion: old?.eventVersion,
          data: old?.data,
        }),
      );
    }
    if (!existing || existingHash !== payloadHash)
      return json(requestId, 409, {
        error: {
          code: "WEBHOOK_EVENT_CONFLICT",
          message: "Event identity was already used for different evidence",
          requestId,
        },
      });
    if (existing.processing_status === "APPLIED")
      return json(requestId, 200, { ok: true, duplicate: true, requestId });
    // Preserve the first verified callback time when transport retry timestamps change.
    parsed = parseLalamoveEvent(JSON.parse(existing.raw_payload)) ?? parsed;
  }
  const result = await applyProviderEvent(database, parsed, inboxId);
  log(result.outcome === "RECONCILIATION_REQUIRED" ? "warn" : "info", "delivery_provider_webhook", {
    requestId,
    provider: "lalamove",
    result: result.outcome,
  });
  if (result.outcome === "RECONCILIATION_REQUIRED")
    return json(
      requestId,
      parsed.kind === "UNKNOWN" || result.reason === "DELIVERY_DISPATCH_NOT_FOUND" ? 200 : 202,
      { ok: true, reconciliationRequired: true, requestId },
    );
  return json(requestId, 200, {
    ok: true,
    duplicate: result.outcome === "DUPLICATE",
    ...(result.outcome === "OLDER" ? { ignoredAsOlder: true } : {}),
    requestId,
  });
}
