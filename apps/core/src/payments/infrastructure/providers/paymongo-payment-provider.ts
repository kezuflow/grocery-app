import type { PaymentDomainState } from "../../domain/payment";
import type {
  PaymentProvider,
  ProviderPaymentView,
  ProviderSubscriptionStatus,
  ProviderSubscriptionView,
  VerifiedProviderEvent,
} from "../../ports/payment-provider";

const DEFAULT_API_BASE = "https://api.paymongo.com";
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const PROVIDER_ACTION_TTL_MS = 60 * 60 * 1000;

type JsonObject = Record<string, unknown>;
type Fetcher = typeof fetch;

export type PayMongoPaymentProviderConfiguration = {
  secretKey: string;
  webhookSecret: string;
  allowedPaymentMethods?: readonly string[];
  apiBaseUrl?: string;
  fetcher?: Fetcher;
  now?: () => number;
};

class PayMongoApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "PayMongoApiError";
  }
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function resource(payload: unknown): { id: string; type: string; attributes: JsonObject } | null {
  const data = object(object(payload)?.data);
  const id = string(data?.id);
  const type = string(data?.type);
  const attributes = object(data?.attributes);
  return id && type && attributes ? { id, type, attributes } : null;
}

function unixSeconds(value: unknown): number | null {
  const parsed = integer(value);
  return parsed === null ? null : parsed * 1000;
}

function dateOnly(value: unknown): number | null {
  const parsed = string(value);
  if (!parsed || !/^\d{4}-\d{2}-\d{2}$/.test(parsed)) return null;
  const epoch = Date.parse(`${parsed}T00:00:00+08:00`);
  return Number.isFinite(epoch) ? epoch : null;
}

function subscriptionStatus(value: unknown): ProviderSubscriptionStatus | null {
  switch (value) {
    case "incomplete":
      return "INCOMPLETE";
    case "incomplete_cancelled":
      return "INCOMPLETE_CANCELED";
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "unpaid":
      return "UNPAID";
    case "cancelled":
      return "CANCELED";
    default:
      return null;
  }
}

function paymentState(value: unknown): PaymentDomainState | null {
  switch (value) {
    case "awaiting_payment_method":
    case "awaiting_next_action":
      return "REQUIRES_ACTION";
    case "processing":
    case "pending":
      return "PROCESSING";
    case "succeeded":
    case "paid":
      return "SUCCEEDED";
    case "failed":
      return "FAILED";
    case "cancelled":
      return "EXPIRED";
    default:
      return null;
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES)
    throw new PayMongoApiError("PAYMONGO_RESPONSE_TOO_LARGE", response.status);
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel();
      throw new PayMongoApiError("PAYMONGO_RESPONSE_TOO_LARGE", response.status);
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
    throw new PayMongoApiError("PAYMONGO_INVALID_RESPONSE", response.status);
  }
}

function providerError(payload: unknown, status: number): string {
  const errors = object(payload)?.errors;
  const first = Array.isArray(errors) ? object(errors[0]) : null;
  const code = string(object(first?.code)?.code) ?? string(first?.code);
  return code ? `PAYMONGO_${code.toUpperCase()}` : `PAYMONGO_HTTP_${status}`;
}

function subscriptionView(payload: unknown): ProviderSubscriptionView | null {
  const item = resource(payload);
  if (!item || item.type !== "subscription") return null;
  const status = subscriptionStatus(item.attributes.status);
  const customerReference = string(item.attributes.customer_id);
  const planObject = object(item.attributes.plan);
  const planReference = string(item.attributes.plan_id) ?? string(planObject?.id);
  if (!status || !customerReference || !planReference) return null;
  const invoice = object(item.attributes.latest_invoice);
  const paymentIntent = object(invoice?.payment_intent);
  return {
    providerSubscriptionReference: item.id,
    providerPlanReference: planReference,
    providerCustomerReference: customerReference,
    providerStatus: status,
    latestInvoiceReference: string(invoice?.id),
    providerPaymentReference: string(paymentIntent?.id),
    clientToken: string(paymentIntent?.client_key),
    nextBillingAt: dateOnly(item.attributes.next_billing_schedule),
  };
}

export function createPayMongoPaymentProvider(
  configuration: PayMongoPaymentProviderConfiguration,
): PaymentProvider {
  if (!/^sk_(test|live)_/.test(configuration.secretKey))
    throw new Error("PAYMONGO_SECRET_KEY_INVALID");
  if (!configuration.webhookSecret.trim()) throw new Error("PAYMONGO_WEBHOOK_SECRET_REQUIRED");
  const liveMode = configuration.secretKey.startsWith("sk_live_");
  const fetcher = configuration.fetcher ?? fetch;
  const now = configuration.now ?? Date.now;
  const apiBaseUrl = (configuration.apiBaseUrl ?? DEFAULT_API_BASE).replace(/\/$/, "");
  const allowedPaymentMethods = configuration.allowedPaymentMethods ?? ["card"];
  const authorization = `Basic ${btoa(`${configuration.secretKey}:`)}`;

  async function api(
    path: string,
    init: RequestInit = {},
    idempotencyKey?: string,
  ): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("authorization", authorization);
    headers.set("accept", "application/json");
    if (init.body) headers.set("content-type", "application/json");
    if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
    const response = await fetcher(`${apiBaseUrl}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(10_000),
    });
    const payload = await readBoundedJson(response);
    if (!response.ok)
      throw new PayMongoApiError(providerError(payload, response.status), response.status);
    return payload;
  }

  async function getPaymentIntent(reference: string): Promise<{
    view: ProviderPaymentView;
    clientToken: string | null;
    paymentReference: string | null;
  } | null> {
    try {
      const payload = await api(`/v1/payment_intents/${encodeURIComponent(reference)}`);
      const item = resource(payload);
      const state = paymentState(item?.attributes.status);
      const amountMinor = integer(item?.attributes.amount);
      const currency = string(item?.attributes.currency)?.toUpperCase() ?? null;
      if (!item || item.type !== "payment_intent" || !state || amountMinor === null || !currency)
        return null;
      const payments = item.attributes.payments;
      const paid = Array.isArray(payments)
        ? payments
            .map(object)
            .find(
              (candidate) =>
                candidate?.attributes &&
                paymentState(object(candidate.attributes)?.status) === "SUCCEEDED",
            )
        : null;
      return {
        view: { providerReference: item.id, canonicalState: state, amountMinor, currency },
        clientToken: string(item.attributes.client_key),
        paymentReference: string(paid?.id),
      };
    } catch (error) {
      if (error instanceof PayMongoApiError && error.status === 404) return null;
      throw error;
    }
  }

  return {
    code: "paymongo",
    async createPayment(input) {
      try {
        const payload = await api(
          "/v1/payment_intents",
          {
            method: "POST",
            body: JSON.stringify({
              data: {
                attributes: {
                  amount: input.amountMinor,
                  currency: input.currency.toUpperCase(),
                  payment_method_allowed: allowedPaymentMethods,
                  description: "FreshMarkets order payment",
                  metadata: { freshmarkets_idempotency_key: input.idempotencyKey },
                },
              },
            }),
          },
          input.idempotencyKey,
        );
        const item = resource(payload);
        const clientToken = string(item?.attributes.client_key);
        if (!item || item.type !== "payment_intent" || !clientToken)
          return { ok: false, errorCode: "PAYMONGO_INVALID_RESPONSE" };
        return {
          ok: true,
          providerReference: item.id,
          actionType: "SDK",
          redirectUrl: null,
          clientToken,
          expiresAt: now() + PROVIDER_ACTION_TTL_MS,
        };
      } catch (error) {
        return {
          ok: false,
          errorCode: error instanceof PayMongoApiError ? error.code : "PAYMONGO_UNAVAILABLE",
        };
      }
    },
    async verifyAndParseEvent(headers, rawBody) {
      const signatureHeader = headers.get("paymongo-signature");
      if (!signatureHeader) return { ok: false, reason: "INVALID_SIGNATURE" };
      const parts = new Map(
        signatureHeader.split(",").map((part) => {
          const [key, ...rest] = part.trim().split("=");
          return [key, rest.join("=")] as const;
        }),
      );
      const timestampText = parts.get("t") ?? "";
      const timestamp = Number(timestampText);
      const supplied = parts.get(liveMode ? "li" : "te") ?? "";
      if (!Number.isSafeInteger(timestamp)) return { ok: false, reason: "INVALID_TIMESTAMP" };
      if (Math.abs(Math.floor(now() / 1000) - timestamp) > WEBHOOK_TOLERANCE_SECONDS)
        return { ok: false, reason: "INVALID_TIMESTAMP" };
      const expected = await hmacSha256(configuration.webhookSecret, `${timestampText}.${rawBody}`);
      if (!timingSafeHexEqual(supplied, expected))
        return { ok: false, reason: "INVALID_SIGNATURE" };

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody) as unknown;
      } catch {
        return { ok: false, reason: "UNPARSEABLE_PAYLOAD", signatureVerified: true };
      }
      const event = resource(payload);
      const eventType = string(event?.attributes.type);
      const eventData = object(event?.attributes.data);
      const subject = eventData ? resource({ data: eventData }) : null;
      const observedAt = unixSeconds(event?.attributes.created_at);
      if (!event || event.type !== "event" || !eventType || !subject || observedAt === null)
        return { ok: false, reason: "UNPARSEABLE_PAYLOAD", signatureVerified: true };
      const payloadHash = await sha256(rawBody);

      let normalized: VerifiedProviderEvent | null = null;
      if (eventType === "payment.paid" || eventType === "payment.failed") {
        const amountMinor = integer(subject.attributes.amount);
        const currency = string(subject.attributes.currency)?.toUpperCase() ?? null;
        const providerReference = string(subject.attributes.payment_intent_id);
        const canonicalState = paymentState(subject.attributes.status);
        if (amountMinor !== null && currency && providerReference && canonicalState) {
          const fee = integer(subject.attributes.fee) ?? 0;
          const net = integer(subject.attributes.net_amount) ?? amountMinor - fee;
          normalized = {
            provider: "paymongo",
            providerEventId: event.id,
            eventType,
            providerReference,
            observedAt,
            payloadHash,
            canonicalState,
            amountMinor,
            currency,
            kind: "payment",
            refundReference: null,
            settlement:
              canonicalState === "SUCCEEDED"
                ? {
                    grossMinor: amountMinor,
                    processingCostMinor: fee,
                    withholdingMinor: 0,
                    adjustmentMinor: 0,
                    netMinor: net,
                    currency,
                    observedAt,
                  }
                : undefined,
          };
        }
      } else if (
        eventType === "refund.succeeded" ||
        eventType === "payment.refunded" ||
        eventType === "payment.refund.updated"
      ) {
        const amountMinor = integer(subject.attributes.amount);
        const currency = string(subject.attributes.currency)?.toUpperCase() ?? "PHP";
        const state = paymentState(subject.attributes.status);
        if (amountMinor !== null && state) {
          normalized = {
            provider: "paymongo",
            providerEventId: event.id,
            eventType,
            providerReference: string(subject.attributes.payment_id) ?? subject.id,
            observedAt,
            payloadHash,
            canonicalState: state,
            amountMinor,
            currency,
            kind: "refund",
            refundReference: subject.id,
          };
        }
      } else if (
        eventType.startsWith("subscription.") &&
        !eventType.startsWith("subscription.invoice.")
      ) {
        const status = subscriptionStatus(subject.attributes.status);
        const customerReference = string(subject.attributes.customer_id);
        const planReference =
          string(subject.attributes.plan_id) ?? string(object(subject.attributes.plan)?.id);
        if (status && customerReference && planReference) {
          normalized = {
            provider: "paymongo",
            providerEventId: event.id,
            eventType,
            providerReference: subject.id,
            observedAt,
            payloadHash,
            kind: "subscription",
            providerStatus: status,
            providerCustomerReference: customerReference,
            providerPlanReference: planReference,
            providerPaymentMethodReference:
              string(subject.attributes.payment_method_id) ??
              string(subject.attributes.default_customer_payment_method_id),
            latestInvoiceReference: string(object(subject.attributes.latest_invoice)?.id),
            nextBillingAt: dateOnly(subject.attributes.next_billing_schedule),
          };
        }
      } else if (eventType.startsWith("subscription.invoice.")) {
        const statusValue = string(subject.attributes.status)?.toUpperCase();
        const providerSubscriptionReference =
          string(subject.attributes.resource_id) ??
          string(object(subject.attributes.subscription)?.id);
        const amountMinor = integer(subject.attributes.amount);
        const currency = string(subject.attributes.currency)?.toUpperCase() ?? null;
        if (
          providerSubscriptionReference &&
          amountMinor !== null &&
          currency &&
          (statusValue === "DRAFT" ||
            statusValue === "OPEN" ||
            statusValue === "PAID" ||
            statusValue === "VOID")
        ) {
          normalized = {
            provider: "paymongo",
            providerEventId: event.id,
            eventType,
            providerReference: subject.id,
            observedAt,
            payloadHash,
            kind: "subscription_invoice",
            providerSubscriptionReference,
            providerPaymentReference: string(object(subject.attributes.payment_intent)?.id),
            providerStatus: statusValue,
            amountMinor,
            currency,
            dueAt: dateOnly(subject.attributes.due_date),
            paidAt: statusValue === "PAID" ? observedAt : null,
          };
        }
      }
      return normalized
        ? { ok: true, event: normalized }
        : { ok: false, reason: "UNKNOWN_EVENT_TYPE", signatureVerified: true };
    },
    async createAuthorization() {
      return { ok: false, errorCode: "PAYMONGO_SUBSCRIPTION_FLOW_REQUIRED" };
    },
    async getAuthorization() {
      return { ok: false, errorCode: "PAYMONGO_SUBSCRIPTION_FLOW_REQUIRED" };
    },
    async getPayment(providerReference) {
      return (await getPaymentIntent(providerReference))?.view ?? null;
    },
    async requestRefund(input) {
      try {
        const intent = await getPaymentIntent(input.providerReference);
        if (!intent?.paymentReference)
          return { ok: false, errorCode: "PAYMONGO_PAYMENT_NOT_CAPTURED" };
        const payload = await api(
          "/v1/refunds",
          {
            method: "POST",
            body: JSON.stringify({
              data: {
                attributes: {
                  amount: input.amountMinor,
                  payment_id: intent.paymentReference,
                  reason: "requested_by_customer",
                  metadata: { freshmarkets_refund_key: input.refundProviderIdempotencyKey },
                },
              },
            }),
          },
          input.refundProviderIdempotencyKey,
        );
        const item = resource(payload);
        return item?.type === "refund"
          ? { ok: true, providerRefundReference: item.id }
          : { ok: false, errorCode: "PAYMONGO_INVALID_RESPONSE" };
      } catch (error) {
        return {
          ok: false,
          errorCode: error instanceof PayMongoApiError ? error.code : "PAYMONGO_UNAVAILABLE",
        };
      }
    },
    async ensureCustomer(input) {
      if (input.existingProviderCustomerReference)
        return { ok: true, providerCustomerReference: input.existingProviderCustomerReference };
      try {
        const payload = await api(
          "/v1/customers",
          {
            method: "POST",
            body: JSON.stringify({
              data: {
                attributes: {
                  first_name: input.profile.firstName,
                  last_name: input.profile.lastName,
                  email: input.profile.email,
                  ...(input.profile.phone ? { phone: input.profile.phone } : {}),
                  default_device: input.profile.phone ? "phone" : "email",
                  metadata: { freshmarkets_customer_id: input.profile.customerId },
                },
              },
            }),
          },
          input.idempotencyKey,
        );
        const item = resource(payload);
        return item?.type === "customer"
          ? { ok: true, providerCustomerReference: item.id }
          : { ok: false, errorCode: "PAYMONGO_INVALID_RESPONSE" };
      } catch (error) {
        return {
          ok: false,
          errorCode: error instanceof PayMongoApiError ? error.code : "PAYMONGO_UNAVAILABLE",
        };
      }
    },
    async ensureSubscriptionPlan(input) {
      if (input.existingProviderPlanReference)
        return { ok: true, providerPlanReference: input.existingProviderPlanReference };
      try {
        const payload = await api(
          "/v1/subscriptions/plans",
          {
            method: "POST",
            body: JSON.stringify({
              data: {
                attributes: {
                  plan_type: "scheduled",
                  amount: input.amountMinor,
                  currency: input.currency.toUpperCase(),
                  description: input.description,
                  interval: "monthly",
                  interval_count: 1,
                  name: input.name,
                  metadata: { freshmarkets_price_version_id: input.priceVersionId },
                },
              },
            }),
          },
          input.idempotencyKey,
        );
        const item = resource(payload);
        return item?.type === "plan"
          ? { ok: true, providerPlanReference: item.id }
          : { ok: false, errorCode: "PAYMONGO_INVALID_RESPONSE" };
      } catch (error) {
        return {
          ok: false,
          errorCode: error instanceof PayMongoApiError ? error.code : "PAYMONGO_UNAVAILABLE",
        };
      }
    },
    async createSubscription(input) {
      try {
        const payload = await api(
          "/v1/subscriptions",
          {
            method: "POST",
            body: JSON.stringify({
              data: {
                attributes: {
                  customer_id: input.providerCustomerReference,
                  plan_id: input.providerPlanReference,
                },
              },
            }),
          },
          input.idempotencyKey,
        );
        let view = subscriptionView(payload);
        if (!view) return { ok: false, errorCode: "PAYMONGO_INVALID_RESPONSE" };
        if (view.providerPaymentReference && !view.clientToken) {
          const intent = await getPaymentIntent(view.providerPaymentReference);
          view = { ...view, clientToken: intent?.clientToken ?? null };
        }
        return { ok: true, subscription: view };
      } catch (error) {
        return {
          ok: false,
          errorCode: error instanceof PayMongoApiError ? error.code : "PAYMONGO_UNAVAILABLE",
        };
      }
    },
    async getSubscription(providerSubscriptionReference) {
      try {
        const payload = await api(
          `/v1/subscriptions/${encodeURIComponent(providerSubscriptionReference)}`,
        );
        let view = subscriptionView(payload);
        if (!view) return { ok: false, errorCode: "PAYMONGO_INVALID_RESPONSE" };
        if (view.providerPaymentReference && !view.clientToken) {
          const intent = await getPaymentIntent(view.providerPaymentReference);
          view = { ...view, clientToken: intent?.clientToken ?? null };
        }
        return { ok: true, subscription: view };
      } catch (error) {
        return {
          ok: false,
          errorCode: error instanceof PayMongoApiError ? error.code : "PAYMONGO_UNAVAILABLE",
        };
      }
    },
    async cancelSubscription(input) {
      try {
        const payload = await api(
          `/v1/subscriptions/${encodeURIComponent(input.providerSubscriptionReference)}/cancel`,
          {
            method: "POST",
            body: JSON.stringify({
              data: { attributes: { cancellation_reason: input.reason } },
            }),
          },
        );
        const view = subscriptionView(payload);
        return view
          ? { ok: true, subscription: view }
          : { ok: false, errorCode: "PAYMONGO_INVALID_RESPONSE" };
      } catch (error) {
        return {
          ok: false,
          errorCode: error instanceof PayMongoApiError ? error.code : "PAYMONGO_UNAVAILABLE",
        };
      }
    },
  };
}
