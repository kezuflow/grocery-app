import type { PaymentDomainState } from "../../domain/payment";
import type {
  PaymentProvider,
  ProviderEventVerificationFailure,
  ProviderEventVerificationSuccess,
  ProviderPaymentView,
} from "../../ports/payment-provider";

const API_BASE = "https://api.paymongo.com/v1";
const TIMESTAMP_TOLERANCE_MS = 5 * 60_000;

type PayMongoNode = {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown> & {
    checkout_url?: unknown;
    data?: PayMongoNode;
  };
};

type PayMongoEnvelope = { data?: PayMongoNode };

export type PayMongoConfig = {
  secretKey: string;
  webhookSecretTest?: string;
  webhookSecretLive?: string;
};

type EventMapping = { state: PaymentDomainState; kind: "payment" | "refund" };

// Canonical translation is closed: unknown provider event types are rejected
// rather than guessed, so ingestion can never fabricate a state.
const EVENT_STATE_BY_TYPE: Record<string, EventMapping> = {
  "payment.paid": { state: "SUCCEEDED", kind: "payment" },
  "payment.failed": { state: "FAILED", kind: "payment" },
  "payment.expired": { state: "EXPIRED", kind: "payment" },
  "refund.paid": { state: "SUCCEEDED", kind: "refund" },
};

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time equality over equal-length lowercase hex digests. */
function timingSafeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

async function sha256Hex(payload: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)));
}

function authHeader(secretKey: string): string {
  // PayMongo authenticates with HTTP Basic whose username is the secret key.
  const encoded = btoa(`${secretKey}:`);
  return `Basic ${encoded}`;
}

/**
 * Production PayMongo adapter behind the Payments port. Verifies signatures
 * before trusting any content, translates vendor vocabulary into canonical
 * states at this boundary only, and never reports canonical success from a
 * client action.
 */
export class PayMongoProvider implements PaymentProvider {
  readonly code = "paymongo";
  private readonly config: PayMongoConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: PayMongoConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async createPayment(input: {
    providerCustomerId: string | null;
    amountMinor: number;
    currency: string;
    returnUrl: string;
    idempotencyKey: string;
  }): Promise<
    | {
        ok: true;
        providerReference: string;
        actionType: "NONE" | "REDIRECT" | "SDK";
        redirectUrl: string | null;
        clientToken: string | null;
        expiresAt: number | null;
      }
    | { ok: false; errorCode: string }
  > {
    const response = await this.request("/checkout_sessions", input.idempotencyKey, {
      data: {
        attributes: {
          amount: input.amountMinor,
          currency: input.currency.toUpperCase(),
          reference_number: input.idempotencyKey,
          success_url: input.returnUrl,
        },
      },
    });
    if (!response.ok) return { ok: false, errorCode: response.errorCode };
    const session = response.body?.data;
    const checkoutUrl = session?.attributes?.checkout_url;
    if (!session?.id || typeof checkoutUrl !== "string")
      return { ok: false, errorCode: "PROVIDER_MALFORMED_RESPONSE" };
    return {
      ok: true,
      providerReference: session.id,
      actionType: "REDIRECT",
      redirectUrl: checkoutUrl,
      clientToken: null,
      expiresAt: null,
    };
  }

  async verifyAndParseEvent(
    headers: Headers,
    rawBody: string,
  ): Promise<ProviderEventVerificationSuccess | ProviderEventVerificationFailure> {
    const signatureHeader = headers.get("paymongo-signature") ?? "";
    const parts = new Map(
      signatureHeader
        .split(",")
        .map((part) => part.trim().split("=", 2))
        .filter((pair) => pair.length === 2) as Array<[string, string]>,
    );
    const timestamp = parts.get("t");
    const testSignature = parts.get("te");
    const liveSignature = parts.get("li");
    if (!timestamp || (!testSignature && !liveSignature)) return this.failure("INVALID_SIGNATURE");

    const now = Date.now();
    const signedAt = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(signedAt) || Math.abs(now - signedAt * 1000) > TIMESTAMP_TOLERANCE_MS)
      return this.failure("INVALID_TIMESTAMP");

    const candidates: Array<{ field: string | undefined; secret: string | undefined }> = [
      { field: liveSignature, secret: this.config.webhookSecretLive },
      { field: testSignature, secret: this.config.webhookSecretTest },
    ];
    let verified = false;
    for (const candidate of candidates) {
      if (!candidate.field || !candidate.secret) continue;
      const expected = await hmacSha256Hex(candidate.secret, `${timestamp}.${rawBody}`);
      if (timingSafeHexEqual(expected, candidate.field.toLowerCase())) verified = true;
    }
    if (!verified) return this.failure("INVALID_SIGNATURE");

    let parsed: {
      data?: {
        id?: string;
        type?: string;
        attributes?: {
          data?: { id?: string; attributes?: { amount?: number; currency?: string } };
        };
      };
    };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return this.failure("UNPARSEABLE_PAYLOAD");
    }
    const eventType = parsed.data?.type;
    const mapping = eventType ? EVENT_STATE_BY_TYPE[eventType] : undefined;
    if (!eventType || !mapping || !parsed.data?.id) return this.failure("UNKNOWN_EVENT_TYPE");

    const inner = parsed.data.attributes?.data;
    const providerReference = inner?.id ?? "";
    if (!providerReference) return this.failure("UNPARSEABLE_PAYLOAD");

    return {
      ok: true,
      event: {
        provider: "paymongo",
        providerEventId: parsed.data.id,
        providerReference,
        observedAt: now,
        canonicalState: mapping.state,
        amountMinor: typeof inner?.attributes?.amount === "number" ? inner.attributes.amount : 0,
        currency:
          typeof inner?.attributes?.currency === "string"
            ? inner.attributes.currency.toUpperCase()
            : "",
        payloadHash: await sha256Hex(rawBody),
        kind: mapping.kind,
        refundReference: mapping.kind === "refund" ? providerReference : null,
      },
    };
  }

  async getPayment(providerReference: string): Promise<ProviderPaymentView | null> {
    const direct = await this.request(
      `/payments/${encodeURIComponent(providerReference)}`,
      null,
      null,
      "GET",
    );
    if (direct.ok) {
      const attributes = direct.body?.data?.attributes;
      if (attributes)
        return {
          providerReference,
          canonicalState: this.paymentStatusToCanonical(attributes.status),
          amountMinor: typeof attributes.amount === "number" ? attributes.amount : 0,
          currency:
            typeof attributes.currency === "string" ? attributes.currency.toUpperCase() : "",
        };
    }
    // References created through checkout sessions resolve via the session.
    const session = await this.request(
      `/checkout_sessions/${encodeURIComponent(providerReference)}`,
      null,
      null,
      "GET",
    );
    if (!session.ok) return null;
    const attributes = session.body?.data?.attributes;
    if (!attributes) return null;
    const paidAt = attributes.paid_at;
    return {
      providerReference,
      canonicalState:
        typeof paidAt === "number" ? "SUCCEEDED" : this.sessionStatusToCanonical(attributes.status),
      amountMinor: typeof attributes.amount === "number" ? attributes.amount : 0,
      currency: typeof attributes.currency === "string" ? attributes.currency.toUpperCase() : "",
    };
  }

  async requestRefund(input: {
    providerReference: string;
    refundProviderIdempotencyKey: string;
    amountMinor: number;
    currency: string;
  }): Promise<{ ok: true; providerRefundReference: string } | { ok: false; errorCode: string }> {
    const response = await this.request("/refunds", input.refundProviderIdempotencyKey, {
      data: {
        attributes: {
          payment_id: input.providerReference,
          amount: input.amountMinor,
          currency: input.currency.toUpperCase(),
        },
      },
    });
    if (!response.ok) return { ok: false, errorCode: response.errorCode };
    const id = response.body?.data?.id;
    return typeof id === "string"
      ? { ok: true, providerRefundReference: id }
      : { ok: false, errorCode: "PROVIDER_MALFORMED_RESPONSE" };
  }

  private paymentStatusToCanonical(status: unknown): PaymentDomainState {
    switch (status) {
      case "psc":
      case "succeeded":
      case "paid":
        return "SUCCEEDED";
      case "failed":
        return "FAILED";
      case "expired":
        return "EXPIRED";
      default:
        return "PROCESSING";
    }
  }

  private sessionStatusToCanonical(status: unknown): PaymentDomainState {
    switch (status) {
      case "succeeded":
      case "paid":
        return "SUCCEEDED";
      case "cancelled":
      case "canceled":
        return "EXPIRED";
      default:
        return "PROCESSING";
    }
  }

  private failure(
    reason: ProviderEventVerificationFailure["reason"],
  ): ProviderEventVerificationFailure {
    return { ok: false, reason };
  }

  private async request(
    path: string,
    idempotencyKey: string | null,
    body: unknown,
    method: "POST" | "GET" = body !== null || idempotencyKey !== null ? "POST" : "GET",
  ): Promise<{ ok: true; body: PayMongoEnvelope } | { ok: false; errorCode: string }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${API_BASE}${path}`, {
        method,
        headers: {
          authorization: authHeader(this.config.secretKey),
          "content-type": "application/json",
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        ...(body !== null && method === "POST" ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      return { ok: false, errorCode: "PROVIDER_NETWORK_ERROR" };
    }
    if (!response.ok) return { ok: false, errorCode: `PROVIDER_HTTP_${response.status}` };
    try {
      return { ok: true, body: await response.json() };
    } catch {
      return { ok: false, errorCode: "PROVIDER_MALFORMED_RESPONSE" };
    }
  }
}
