import { splitContactName } from "../../domain/delivery-contact";
import type {
  CreateDeliveryRequest,
  DeliveryContact,
  DeliveryPackage,
  DeliveryProvider,
  DeliveryProviderAddress,
  DeliveryProviderError,
  DeliveryProviderRequest,
  DeliveryProviderResult,
  DeliveryQuote,
  ProviderDelivery,
  ProviderDeliveryStatus,
} from "../../ports/delivery-provider";
import {
  defaultDeliveryProviderTelemetry,
  emitDeliveryProviderTelemetry,
  telemetryStart,
  type DeliveryProviderOperation,
  type DeliveryProviderTelemetry,
} from "../delivery-provider-telemetry";

const TOKEN_URL = "https://partner-api.grab.com/grabid/v1/oauth2/token";
const SANDBOX_API_BASE = "https://partner-api.grab.com/grab-express-sandbox";
const PRODUCTION_API_BASE = "https://partner-api.grab.com/grab-express";
const RESPONSE_LIMIT_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MILLISECONDS = 10_000;
const OAUTH_SCOPE = "grab_express.partner_deliveries";

type JsonObject = Record<string, unknown>;
type Fetcher = typeof fetch;

export type GrabExpressProviderConfiguration = Readonly<{
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "production";
  fetcher?: Fetcher;
  apiBaseUrl?: string;
  tokenUrl?: string;
  telemetry?: DeliveryProviderTelemetry;
  now?: () => number;
}>;

class GrabResponseError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly providerRequestId: string | null,
  ) {
    super(code);
    this.name = "GrabResponseError";
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

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function providerStatus(value: unknown): ProviderDeliveryStatus {
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
      return "UNKNOWN";
  }
}

function amountMinor(amount: unknown, exponent: unknown): number | null {
  const major = finiteNumber(amount);
  const scale = integer(exponent);
  if (major === null || scale === null || scale < 0 || scale > 6) return null;
  const result = major * 10 ** scale;
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

function quote(payload: unknown): DeliveryQuote | null {
  const value = object(payload);
  const service = object(value?.service);
  const currency = object(value?.currency);
  const timeline = object(value?.estimatedTimeline);
  const serviceType = nonemptyString(service?.type);
  const currencyCode = nonemptyString(currency?.code)?.toUpperCase() ?? null;
  const amount = amountMinor(value?.amount, currency?.exponent);
  if (!serviceType || !currencyCode || amount === null) return null;
  return {
    serviceType,
    amountMinor: amount,
    currency: currencyCode,
    estimatedPickupAt: nonemptyString(timeline?.pickup),
    estimatedDropoffAt: nonemptyString(timeline?.dropoff),
    distanceMeters: integer(value?.distance),
  };
}

function delivery(payload: unknown): ProviderDelivery | null {
  const value = object(payload);
  const providerDeliveryId = nonemptyString(value?.deliveryID);
  const merchantOrderId =
    nonemptyString(value?.merchantOrderID) ?? nonemptyString(value?.merchantOrderId);
  if (!providerDeliveryId || !merchantOrderId) return null;
  return {
    providerDeliveryId,
    merchantOrderId,
    status: providerStatus(value?.status),
    trackingUrl: nonemptyString(value?.trackingURL),
    pickupPin: nonemptyString(value?.pickupPin),
    quote: value?.quote === null || value?.quote === undefined ? null : quote(value.quote),
  };
}

function grabContact(contact: DeliveryContact, instruction?: string) {
  const name = splitContactName(contact.name);
  return {
    firstName: name.firstName,
    ...(name.lastName ? { lastName: name.lastName } : {}),
    ...(contact.email ? { email: contact.email } : {}),
    ...(contact.phoneE164 ? { phone: contact.phoneE164.slice(1) } : {}),
    smsEnabled: contact.smsEnabled,
    ...(instruction ? { instruction } : {}),
  };
}

function grabAddress(address: DeliveryProviderAddress) {
  return {
    address: address.formattedAddress,
    ...(address.instructions.buildingUnit ? { keywords: address.instructions.buildingUnit } : {}),
    coordinates: {
      latitude: address.coordinate.latitude,
      longitude: address.coordinate.longitude,
    },
  };
}

function instruction(address: DeliveryProviderAddress): string | undefined {
  const values = [
    address.instructions.buildingUnit,
    address.instructions.landmark,
    address.instructions.gateGuard,
    address.instructions.deliveryNote,
    address.instructions.recipientInstruction,
  ].filter((value): value is string => Boolean(value?.trim()));
  const combined = values.join("; ");
  return combined ? combined.slice(0, 1_000) : undefined;
}

function majorAmount(valueMinor: number, exponent: number): number {
  return valueMinor / 10 ** exponent;
}

function grabPackage(item: DeliveryPackage, currencyExponent: number) {
  return {
    name: item.name.slice(0, 500),
    description: item.description.slice(0, 500),
    quantity: item.quantity,
    ...(item.priceMinor === null ? {} : { price: majorAmount(item.priceMinor, currencyExponent) }),
    dimensions: {
      height: item.heightCentimeters,
      width: item.widthCentimeters,
      depth: item.depthCentimeters,
      weight: item.weightGrams,
    },
  };
}

function requestBody(request: DeliveryProviderRequest) {
  return {
    serviceType: request.serviceType,
    paymentMethod: "CASHLESS",
    payer: "SENDER",
    packages: request.packages.map((item) => grabPackage(item, request.currencyExponent)),
    sender: grabContact(request.sender, instruction(request.origin)),
    recipient: grabContact(request.recipient, instruction(request.destination)),
    origin: grabAddress(request.origin),
    destination: grabAddress(request.destination),
    ...(request.schedule
      ? {
          schedule: {
            pickupTimeFrom: request.schedule.pickupFrom,
            pickupTimeTo: request.schedule.pickupTo,
          },
        }
      : {}),
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > RESPONSE_LIMIT_BYTES)
    throw new GrabResponseError(
      "GRAB_RESPONSE_TOO_LARGE",
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
      throw new GrabResponseError(
        "GRAB_RESPONSE_TOO_LARGE",
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
    throw new GrabResponseError(
      "GRAB_INVALID_RESPONSE",
      response.status,
      providerRequestId(response),
    );
  }
}

function providerRequestId(response: Response): string | null {
  return response.headers.get("x-request-id") ?? response.headers.get("x-grabkit-grab-requestid");
}

function responseError(response: Response): GrabResponseError {
  return new GrabResponseError(
    `GRAB_HTTP_${response.status}`,
    response.status,
    providerRequestId(response),
  );
}

function resultError(
  code: string,
  options: { retryable?: boolean; outcomeUnknown?: boolean } = {},
): Readonly<{ ok: false; error: DeliveryProviderError }> {
  return {
    ok: false,
    error: {
      code,
      retryable: options.retryable ?? false,
      outcomeUnknown: options.outcomeUnknown ?? false,
    },
  };
}

function errorFromResponse(error: GrabResponseError, mutationSent: boolean): DeliveryProviderError {
  const retryable = error.status === 429 || error.status >= 500;
  return {
    code: error.code,
    retryable,
    outcomeUnknown: mutationSent && retryable,
  };
}

function validContact(contact: DeliveryContact): boolean {
  const validPhone = contact.phoneE164 === null || /^\+[1-9]\d{7,14}$/.test(contact.phoneE164);
  const validEmail =
    contact.email === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim());
  return (
    contact.name.trim().length > 0 &&
    validPhone &&
    validEmail &&
    Boolean(contact.phoneE164 || contact.email)
  );
}

function validAddress(address: DeliveryProviderAddress): boolean {
  return (
    address.formattedAddress.trim().length > 0 &&
    Number.isFinite(address.coordinate.latitude) &&
    address.coordinate.latitude >= -90 &&
    address.coordinate.latitude <= 90 &&
    Number.isFinite(address.coordinate.longitude) &&
    address.coordinate.longitude >= -180 &&
    address.coordinate.longitude <= 180
  );
}

function validRequest(request: DeliveryProviderRequest): boolean {
  if (
    !["INSTANT", "SAME_DAY", "BULK"].includes(request.serviceType) ||
    !/^[A-Z]{3}$/.test(request.currencyCode) ||
    !Number.isSafeInteger(request.currencyExponent) ||
    request.currencyExponent < 0 ||
    request.currencyExponent > 6 ||
    request.packages.length === 0
  )
    return false;
  if (
    !validContact(request.sender) ||
    !validContact(request.recipient) ||
    !validAddress(request.origin) ||
    !validAddress(request.destination)
  )
    return false;
  if (
    request.schedule &&
    (!Number.isFinite(Date.parse(request.schedule.pickupFrom)) ||
      !Number.isFinite(Date.parse(request.schedule.pickupTo)) ||
      Date.parse(request.schedule.pickupFrom) >= Date.parse(request.schedule.pickupTo))
  )
    return false;
  return request.packages.every(
    (item) =>
      item.name.trim().length > 0 &&
      item.description.trim().length > 0 &&
      Number.isSafeInteger(item.quantity) &&
      item.quantity > 0 &&
      (item.priceMinor === null ||
        (Number.isSafeInteger(item.priceMinor) && item.priceMinor >= 0)) &&
      [
        item.heightCentimeters,
        item.widthCentimeters,
        item.depthCentimeters,
        item.weightGrams,
      ].every((value) => Number.isSafeInteger(value) && value > 0),
  );
}

export function createGrabExpressProvider(
  configuration: GrabExpressProviderConfiguration,
): DeliveryProvider {
  if (!configuration.clientId.trim()) throw new Error("GRAB_CLIENT_ID_REQUIRED");
  if (!configuration.clientSecret.trim()) throw new Error("GRAB_CLIENT_SECRET_REQUIRED");
  const fetcher = configuration.fetcher ?? fetch;
  const telemetry = configuration.telemetry ?? defaultDeliveryProviderTelemetry;
  const now = configuration.now ?? Date.now;
  const apiBase = (
    configuration.apiBaseUrl ??
    (configuration.environment === "production" ? PRODUCTION_API_BASE : SANDBOX_API_BASE)
  ).replace(/\/$/, "");
  const tokenUrl = configuration.tokenUrl ?? TOKEN_URL;
  let tokenCache: { value: string; refreshAt: number } | null = null;

  async function accessToken(): Promise<DeliveryProviderResult<string>> {
    if (tokenCache && now() < tokenCache.refreshAt) return { ok: true, value: tokenCache.value };
    let response: Response;
    try {
      response = await fetcher(tokenUrl, {
        method: "POST",
        headers: { "cache-control": "no-cache", "content-type": "application/json" },
        body: JSON.stringify({
          client_id: configuration.clientId,
          client_secret: configuration.clientSecret,
          grant_type: "client_credentials",
          scope: OAUTH_SCOPE,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
      });
    } catch {
      return resultError("GRAB_AUTH_UNAVAILABLE", { retryable: true });
    }
    let payload: unknown;
    try {
      payload = await readBoundedJson(response);
    } catch (error) {
      const detail =
        error instanceof GrabResponseError
          ? errorFromResponse(error, false)
          : { code: "GRAB_AUTH_INVALID_RESPONSE", retryable: true, outcomeUnknown: false };
      return { ok: false, error: detail };
    }
    if (!response.ok)
      return resultError(`GRAB_AUTH_HTTP_${response.status}`, {
        retryable: response.status >= 500,
      });
    const token = nonemptyString(object(payload)?.access_token);
    const expiresInSeconds = finiteNumber(object(payload)?.expires_in);
    if (!token) return resultError("GRAB_AUTH_INVALID_RESPONSE", { retryable: true });
    const usableLifetime = Math.max(1_000, (expiresInSeconds ?? 300) * 1_000 - 30_000);
    tokenCache = { value: token, refreshAt: now() + usableLifetime };
    return { ok: true, value: token };
  }

  async function api(
    path: string,
    init: RequestInit,
    mutationSent: boolean,
  ): Promise<DeliveryProviderResult<{ payload: unknown; providerRequestId: string | null }>> {
    const token = await accessToken();
    if (!token.ok) return token;
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token.value}`);
    headers.set("cache-control", "no-cache");
    headers.set("content-type", "application/json");
    let response: Response;
    try {
      response = await fetcher(`${apiBase}${path}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
      });
    } catch {
      return resultError(mutationSent ? "GRAB_OUTCOME_UNKNOWN" : "GRAB_UNAVAILABLE", {
        retryable: true,
        outcomeUnknown: mutationSent,
      });
    }
    if (response.status === 401) {
      tokenCache = null;
      const refreshed = await accessToken();
      if (!refreshed.ok) return refreshed;
      headers.set("authorization", `Bearer ${refreshed.value}`);
      try {
        response = await fetcher(`${apiBase}${path}`, {
          ...init,
          headers,
          signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
        });
      } catch {
        return resultError(mutationSent ? "GRAB_OUTCOME_UNKNOWN" : "GRAB_UNAVAILABLE", {
          retryable: true,
          outcomeUnknown: mutationSent,
        });
      }
    }
    let payload: unknown;
    try {
      payload = await readBoundedJson(response);
    } catch (error) {
      if (error instanceof GrabResponseError)
        return {
          ok: false,
          error: errorFromResponse(error, mutationSent),
          ...(error.providerRequestId ? { providerRequestId: error.providerRequestId } : {}),
        };
      return resultError("GRAB_INVALID_RESPONSE", {
        retryable: true,
        outcomeUnknown: mutationSent,
      });
    }
    if (!response.ok)
      return {
        ok: false,
        error: errorFromResponse(responseError(response), mutationSent),
        ...(providerRequestId(response) ? { providerRequestId: providerRequestId(response)! } : {}),
      };
    const requestId = providerRequestId(response);
    return {
      ok: true,
      value: { payload, providerRequestId: requestId },
      ...(requestId ? { providerRequestId: requestId } : {}),
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
    code: "grab-express",
    quote(request) {
      return observed("GRAB_EXPRESS_QUOTE", async () => {
        if (!validRequest(request)) return resultError("GRAB_INVALID_REQUEST");
        const response = await api(
          "/v1/deliveries/quotes",
          { method: "POST", body: JSON.stringify(requestBody(request)) },
          false,
        );
        if (!response.ok) return response;
        const values = object(response.value.payload)?.quotes;
        if (!Array.isArray(values))
          return resultError("GRAB_INVALID_RESPONSE", { retryable: true });
        const quotes = values.map(quote);
        if (
          !quotes.every((value): value is DeliveryQuote => value !== null) ||
          quotes.some((value) => value.currency !== request.currencyCode)
        )
          return resultError("GRAB_INVALID_RESPONSE", { retryable: true });
        return {
          ok: true,
          value: quotes,
          ...(response.providerRequestId ? { providerRequestId: response.providerRequestId } : {}),
        };
      });
    },
    create(request: CreateDeliveryRequest) {
      return observed("GRAB_EXPRESS_CREATE", async () => {
        if (!validRequest(request) || !request.merchantOrderId.trim())
          return resultError("GRAB_INVALID_REQUEST");
        const response = await api(
          "/v1/deliveries",
          {
            method: "POST",
            body: JSON.stringify({
              merchantOrderID: request.merchantOrderId,
              ...requestBody(request),
            }),
          },
          true,
        );
        if (!response.ok) return response;
        const value = delivery(response.value.payload);
        return value && (!value.quote || value.quote.currency === request.currencyCode)
          ? {
              ok: true,
              value,
              ...(response.providerRequestId
                ? { providerRequestId: response.providerRequestId }
                : {}),
            }
          : resultError("GRAB_INVALID_RESPONSE", { retryable: true, outcomeUnknown: true });
      });
    },
    get(providerDeliveryId) {
      return observed("GRAB_EXPRESS_GET", async () => {
        if (!providerDeliveryId.trim()) return resultError("GRAB_INVALID_REQUEST");
        const response = await api(
          `/v1/deliveries/${encodeURIComponent(providerDeliveryId)}`,
          { method: "GET" },
          false,
        );
        if (!response.ok) {
          return response.error.code === "GRAB_HTTP_404" ? { ok: true, value: null } : response;
        }
        const value = delivery(response.value.payload);
        return value
          ? {
              ok: true,
              value,
              ...(response.providerRequestId
                ? { providerRequestId: response.providerRequestId }
                : {}),
            }
          : resultError("GRAB_INVALID_RESPONSE", { retryable: true });
      });
    },
    cancel(providerDeliveryId) {
      return observed("GRAB_EXPRESS_CANCEL", async () => {
        if (!providerDeliveryId.trim()) return resultError("GRAB_INVALID_REQUEST");
        const response = await api(
          `/v1/deliveries/${encodeURIComponent(providerDeliveryId)}`,
          { method: "DELETE" },
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
