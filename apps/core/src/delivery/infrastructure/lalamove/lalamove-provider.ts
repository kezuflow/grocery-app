import type {
  DeliveryContact,
  DeliveryProvider,
  DeliveryProviderAddress,
  DeliveryProviderError,
  DeliveryProviderRequest,
  DeliveryProviderResult,
  DeliveryQuote,
  ProviderDelivery,
  ProviderDeliveryStatus,
} from "../../ports/delivery-provider";
import { deliveryPackageKind } from "../../../fulfillment/domain/delivery-package";
import {
  defaultDeliveryProviderTelemetry,
  emitDeliveryProviderTelemetry,
  telemetryStart,
  type DeliveryProviderOperation,
  type DeliveryProviderTelemetry,
} from "../delivery-provider-telemetry";

const SANDBOX_API_BASE = "https://rest.sandbox.lalamove.com";
const PRODUCTION_API_BASE = "https://rest.lalamove.com";
const RESPONSE_LIMIT_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MILLISECONDS = 10_000;
const MAX_REMARK_LENGTH = 1_500;
const MAX_SCHEDULE_AHEAD_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;

type JsonObject = Record<string, unknown>;
type Fetcher = typeof fetch;

export type LalamoveProviderConfiguration = Readonly<{
  apiKey: string;
  apiSecret: string;
  market: string;
  language: string;
  environment: "sandbox" | "production";
  fetcher?: Fetcher;
  apiBaseUrl?: string;
  telemetry?: DeliveryProviderTelemetry;
  now?: () => number;
  requestId?: () => string;
}>;

class LalamoveResponseError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly providerRequestId: string | null,
  ) {
    super(code);
    this.name = "LalamoveResponseError";
  }
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function nonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function resultError(
  code: string,
  options: {
    retryable?: boolean;
    outcomeUnknown?: boolean;
    retryAfterMilliseconds?: number;
  } = {},
): Readonly<{ ok: false; error: DeliveryProviderError }> {
  return {
    ok: false,
    error: {
      code,
      retryable: options.retryable ?? false,
      outcomeUnknown: options.outcomeUnknown ?? false,
      ...(options.retryAfterMilliseconds !== undefined
        ? { retryAfterMilliseconds: options.retryAfterMilliseconds }
        : {}),
    },
  };
}

function providerRequestId(response: Response): string | null {
  return response.headers.get("request-id") ?? response.headers.get("x-request-id");
}

function retryAfterMilliseconds(response: Response, now: number): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? Math.max(0, instant - now) : undefined;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > RESPONSE_LIMIT_BYTES)
    throw new LalamoveResponseError(
      "LALAMOVE_RESPONSE_TOO_LARGE",
      response.status,
      providerRequestId(response),
    );
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > RESPONSE_LIMIT_BYTES) {
      await reader.cancel();
      throw new LalamoveResponseError(
        "LALAMOVE_RESPONSE_TOO_LARGE",
        response.status,
        providerRequestId(response),
      );
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LalamoveResponseError(
      "LALAMOVE_INVALID_RESPONSE",
      response.status,
      providerRequestId(response),
    );
  }
}

function exactMinorAmount(value: unknown, exponent: number): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || exponent < 0 || exponent > 6) return null;
  const fractional = match[2] ?? "";
  if (fractional.length > exponent && /[1-9]/.test(fractional.slice(exponent))) return null;
  const normalized = `${match[1]}${fractional.slice(0, exponent).padEnd(exponent, "0")}`;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) ? amount : null;
}

function status(value: unknown): ProviderDeliveryStatus {
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
      return "UNKNOWN";
  }
}

function distanceMeters(value: unknown): number | null {
  const distance = object(value);
  const raw = distance?.value;
  const numeric = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const unit = nonemptyString(distance?.unit)?.toLowerCase();
  const meters = unit === "km" ? numeric * 1_000 : numeric;
  return Number.isSafeInteger(meters) ? meters : Math.round(meters);
}

function parseQuote(payload: unknown, exponent: number): DeliveryQuote | null {
  const envelope = object(payload);
  const data = object(envelope?.data) ?? envelope;
  const price = object(data?.priceBreakdown);
  const serviceType = nonemptyString(data?.serviceType);
  const currency = nonemptyString(price?.currency)?.toUpperCase() ?? null;
  const amount = exactMinorAmount(price?.total, exponent);
  if (!serviceType || !currency || amount === null) return null;
  return {
    providerQuotationId: nonemptyString(data?.quotationId),
    serviceType,
    amountMinor: amount,
    currency,
    expiresAt: nonemptyString(data?.expiresAt),
    estimatedPickupAt: nonemptyString(data?.scheduleAt),
    estimatedDropoffAt: null,
    distanceMeters: distanceMeters(data?.distance),
  };
}

function merchantReference(data: JsonObject): string | null {
  const metadata = object(data.metadata);
  return nonemptyString(metadata?.merchantOrderId);
}

function parseDelivery(
  payload: unknown,
  exponent: number | null,
  fallbackMerchantOrderId: string | null,
  fallbackQuote: DeliveryQuote | null = null,
): ProviderDelivery | null {
  const envelope = object(payload);
  const data = object(envelope?.data) ?? envelope;
  if (!data) return null;
  const orderId = nonemptyString(data.orderId);
  if (!orderId) return null;
  const parsedQuote =
    exponent !== null && object(data.priceBreakdown)
      ? parseQuote(
          {
            data: {
              serviceType: data.serviceType ?? fallbackQuote?.serviceType,
              priceBreakdown: data.priceBreakdown,
              distance: data.distance,
              scheduleAt: data.scheduleAt,
            },
          },
          exponent,
        )
      : fallbackQuote;
  return {
    providerDeliveryId: orderId,
    merchantOrderId: merchantReference(data) ?? fallbackMerchantOrderId,
    status: status(data.status),
    trackingUrl: nonemptyString(data.shareLink),
    pickupPin: null,
    quote: parsedQuote,
  };
}

function remarks(request: DeliveryProviderRequest): string | undefined {
  const address = request.destination;
  const deliveryPackage = request.packages[0];
  const values = [
    deliveryPackage ? `Package: 1 ${deliveryPackage.kind.toLowerCase()}` : null,
    address.instructions.buildingUnit
      ? `Building/unit: ${address.instructions.buildingUnit.trim()}`
      : null,
    address.instructions.landmark ? `Landmark: ${address.instructions.landmark.trim()}` : null,
    address.instructions.gateGuard ? `Gate/guard: ${address.instructions.gateGuard.trim()}` : null,
    address.instructions.deliveryNote
      ? `Delivery note: ${address.instructions.deliveryNote.trim()}`
      : null,
    address.instructions.recipientInstruction
      ? `Recipient instruction: ${address.instructions.recipientInstruction.trim()}`
      : null,
  ].filter((value): value is string => value !== null);
  const combined = values.join("\r\n");
  return combined ? combined.slice(0, MAX_REMARK_LENGTH) : undefined;
}

function stop(address: DeliveryProviderAddress) {
  return {
    coordinates: {
      lat: String(address.coordinate.latitude),
      lng: String(address.coordinate.longitude),
    },
    address: address.formattedAddress,
  };
}

function quotationBody(request: DeliveryProviderRequest, language: string) {
  return {
    data: {
      serviceType: request.serviceType,
      language,
      stops: [stop(request.origin), stop(request.destination)],
      ...(request.schedule ? { scheduleAt: request.schedule.pickupFrom } : {}),
    },
  };
}

function contact(value: DeliveryContact, stopId: string, deliveryRemarks?: string) {
  return {
    stopId,
    name: value.name,
    phone: value.phoneE164,
    ...(deliveryRemarks ? { remarks: deliveryRemarks } : {}),
  };
}

function validContact(value: DeliveryContact): boolean {
  return (
    value.name.trim().length > 0 &&
    value.phoneE164 !== null &&
    /^\+[1-9]\d{7,14}$/.test(value.phoneE164)
  );
}

function validAddress(value: DeliveryProviderAddress): boolean {
  return (
    value.formattedAddress.trim().length > 0 &&
    Number.isFinite(value.coordinate.latitude) &&
    value.coordinate.latitude >= -90 &&
    value.coordinate.latitude <= 90 &&
    Number.isFinite(value.coordinate.longitude) &&
    value.coordinate.longitude >= -180 &&
    value.coordinate.longitude <= 180
  );
}

function validRequest(request: DeliveryProviderRequest, now: number): boolean {
  if (
    !request.serviceType.trim() ||
    !/^[A-Z]{3}$/.test(request.currencyCode) ||
    !Number.isSafeInteger(request.currencyExponent) ||
    request.currencyExponent < 0 ||
    request.currencyExponent > 6 ||
    !validContact(request.sender) ||
    !validContact(request.recipient) ||
    !validAddress(request.origin) ||
    !validAddress(request.destination)
  )
    return false;
  if (request.schedule) {
    const pickupFrom = Date.parse(request.schedule.pickupFrom);
    const pickupTo = Date.parse(request.schedule.pickupTo);
    if (
      !Number.isFinite(pickupFrom) ||
      !Number.isFinite(pickupTo) ||
      pickupFrom >= pickupTo ||
      pickupFrom <= now ||
      pickupFrom - now > MAX_SCHEDULE_AHEAD_MILLISECONDS
    )
      return false;
  }
  const deliveryPackage = request.packages[0];
  return (
    request.packages.length === 1 &&
    deliveryPackage !== undefined &&
    (deliveryPackage.kind === "BAG" || deliveryPackage.kind === "BOX") &&
    deliveryPackage.quantity === 1 &&
    Number.isSafeInteger(deliveryPackage.weightGrams) &&
    deliveryPackage.weightGrams > 0 &&
    deliveryPackageKind(deliveryPackage.weightGrams) === deliveryPackage.kind
  );
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function createLalamoveProvider(
  configuration: LalamoveProviderConfiguration,
): DeliveryProvider {
  if (!configuration.apiKey.trim()) throw new Error("LALAMOVE_API_KEY_REQUIRED");
  if (!configuration.apiSecret.trim()) throw new Error("LALAMOVE_API_SECRET_REQUIRED");
  if (!configuration.market.trim()) throw new Error("LALAMOVE_MARKET_REQUIRED");
  if (!configuration.language.trim()) throw new Error("LALAMOVE_LANGUAGE_REQUIRED");
  const fetcher = configuration.fetcher ?? fetch;
  const telemetry = configuration.telemetry ?? defaultDeliveryProviderTelemetry;
  const now = configuration.now ?? Date.now;
  const newRequestId = configuration.requestId ?? (() => crypto.randomUUID());
  const apiBase = (
    configuration.apiBaseUrl ??
    (configuration.environment === "production" ? PRODUCTION_API_BASE : SANDBOX_API_BASE)
  ).replace(/\/$/, "");

  async function api(
    path: string,
    method: "GET" | "POST" | "DELETE",
    body: string,
    mutationSent: boolean,
  ): Promise<DeliveryProviderResult<unknown>> {
    const timestamp = String(now());
    const signature = await hmac(
      configuration.apiSecret,
      `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`,
    );
    let response: Response;
    try {
      response = await fetcher(`${apiBase}${path}`, {
        method,
        headers: {
          authorization: `hmac ${configuration.apiKey}:${timestamp}:${signature}`,
          market: configuration.market,
          "request-id": newRequestId(),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
      });
    } catch {
      return resultError(mutationSent ? "LALAMOVE_OUTCOME_UNKNOWN" : "LALAMOVE_UNAVAILABLE", {
        retryable: true,
        outcomeUnknown: mutationSent,
      });
    }
    let payload: unknown;
    try {
      payload = await readBoundedJson(response);
    } catch (error) {
      const requestId = error instanceof LalamoveResponseError ? error.providerRequestId : null;
      return {
        ok: false,
        error: {
          code: error instanceof LalamoveResponseError ? error.code : "LALAMOVE_INVALID_RESPONSE",
          retryable: true,
          outcomeUnknown: mutationSent,
        },
        ...(requestId ? { providerRequestId: requestId } : {}),
      };
    }
    const requestId =
      providerRequestId(response) ?? nonemptyString(object(object(payload)?.meta)?.requestId);
    if (!response.ok) {
      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      return {
        ok: false,
        error: {
          code: `LALAMOVE_HTTP_${response.status}`,
          retryable,
          outcomeUnknown: mutationSent && retryable,
          ...(response.status === 429
            ? { retryAfterMilliseconds: retryAfterMilliseconds(response, now()) }
            : {}),
        },
        ...(requestId ? { providerRequestId: requestId } : {}),
      };
    }
    return { ok: true, value: payload, ...(requestId ? { providerRequestId: requestId } : {}) };
  }

  async function quotation(request: DeliveryProviderRequest) {
    const response = await api(
      "/v3/quotations",
      "POST",
      JSON.stringify(quotationBody(request, configuration.language)),
      false,
    );
    if (!response.ok) return response;
    const envelope = object(response.value);
    const data = object(envelope?.data);
    const parsed = parseQuote(response.value, request.currencyExponent);
    const quotationId = nonemptyString(data?.quotationId);
    const stops = Array.isArray(data?.stops) ? data.stops.map(object) : [];
    const stopIds = stops.map((value) => nonemptyString(value?.stopId));
    if (
      !parsed ||
      parsed.currency !== request.currencyCode ||
      !quotationId ||
      stopIds.length !== 2 ||
      stopIds.some((value) => value === null)
    )
      return resultError("LALAMOVE_INVALID_RESPONSE", { retryable: true });
    return {
      ok: true as const,
      value: { quote: parsed, quotationId, stopIds: stopIds as [string, string] },
      ...(response.providerRequestId ? { providerRequestId: response.providerRequestId } : {}),
    };
  }

  async function observed<T>(
    operation: DeliveryProviderOperation,
    execute: () => Promise<DeliveryProviderResult<T>>,
  ): Promise<DeliveryProviderResult<T>> {
    const startedAt = telemetryStart(telemetry);
    const result = await execute();
    emitDeliveryProviderTelemetry(telemetry, startedAt, {
      operation,
      result: result.ok ? "SUCCESS" : "FAILURE",
      ...(!result.ok ? { errorCode: result.error.code } : {}),
      ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
    });
    return result;
  }

  return {
    code: "lalamove",
    capabilities: {
      immediateQuotation: true,
      scheduledQuotation: {
        supported: true,
        maximumAdvanceMilliseconds: MAX_SCHEDULE_AHEAD_MILLISECONDS,
      },
      createDelivery: true,
      retrieveDelivery: true,
      cancelDelivery: true,
      signedStatusWebhooks: true,
      requiresPackageDimensions: false,
    },
    quote(request) {
      return observed("LALAMOVE_QUOTE", async () => {
        if (!validRequest(request, now())) return resultError("LALAMOVE_INVALID_REQUEST");
        const response = await quotation(request);
        return response.ok
          ? {
              ok: true,
              value: [response.value.quote],
              ...(response.providerRequestId
                ? { providerRequestId: response.providerRequestId }
                : {}),
            }
          : response;
      });
    },
    create(request) {
      return observed("LALAMOVE_CREATE", async () => {
        if (!validRequest(request, now()) || !request.merchantOrderId.trim())
          return resultError("LALAMOVE_INVALID_REQUEST");
        const quoted = await quotation(request);
        if (!quoted.ok) return quoted;
        const body = JSON.stringify({
          data: {
            quotationId: quoted.value.quotationId,
            sender: contact(request.sender, quoted.value.stopIds[0]),
            recipients: [contact(request.recipient, quoted.value.stopIds[1], remarks(request))],
            isPODEnabled: true,
            metadata: { merchantOrderId: request.merchantOrderId },
          },
        });
        const response = await api("/v3/orders", "POST", body, true);
        if (!response.ok) return response;
        const value = parseDelivery(
          response.value,
          request.currencyExponent,
          request.merchantOrderId,
          quoted.value.quote,
        );
        return value
          ? {
              ok: true,
              value,
              ...(response.providerRequestId
                ? { providerRequestId: response.providerRequestId }
                : {}),
            }
          : resultError("LALAMOVE_INVALID_RESPONSE", {
              retryable: true,
              outcomeUnknown: true,
            });
      });
    },
    get(providerDeliveryId) {
      return observed("LALAMOVE_GET", async () => {
        if (!providerDeliveryId.trim()) return resultError("LALAMOVE_INVALID_REQUEST");
        const response = await api(
          `/v3/orders/${encodeURIComponent(providerDeliveryId)}`,
          "GET",
          "",
          false,
        );
        if (!response.ok)
          return response.error.code === "LALAMOVE_HTTP_404" ? { ok: true, value: null } : response;
        const value = parseDelivery(response.value, null, null);
        return value
          ? {
              ok: true,
              value,
              ...(response.providerRequestId
                ? { providerRequestId: response.providerRequestId }
                : {}),
            }
          : resultError("LALAMOVE_INVALID_RESPONSE", { retryable: true });
      });
    },
    cancel(providerDeliveryId) {
      return observed("LALAMOVE_CANCEL", async () => {
        if (!providerDeliveryId.trim()) return resultError("LALAMOVE_INVALID_REQUEST");
        const response = await api(
          `/v3/orders/${encodeURIComponent(providerDeliveryId)}`,
          "DELETE",
          "",
          true,
        );
        return response.ok
          ? {
              ok: true,
              value: null,
              ...(response.providerRequestId
                ? { providerRequestId: response.providerRequestId }
                : {}),
            }
          : response;
      });
    },
  };
}
