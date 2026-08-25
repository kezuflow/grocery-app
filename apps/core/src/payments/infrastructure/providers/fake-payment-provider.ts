import type {
  ProviderEventVerificationFailure,
  ProviderEventVerificationSuccess,
  PaymentProvider,
  ProviderPaymentView,
} from "../../ports/payment-provider";
import type { PaymentDomainState } from "../../domain/payment";

const FAKE_SHARED_SECRET = "fake-provider-test-secret";

function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return crypto.subtle
    .digest("SHA-256", bytes)
    .then((digest) =>
      [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    );
}

function mapVendorState(vendorState: string): PaymentDomainState | null {
  switch (vendorState) {
    case "paid":
      return "SUCCEEDED";
    case "authorized":
    case "pending":
      return "PROCESSING";
    case "requires_action":
      return "REQUIRES_ACTION";
    case "failed":
      return "FAILED";
    case "expired":
      return "EXPIRED";
    default:
      return null;
  }
}

/**
 * Test-only provider adapter proving the port contract, signed-event parsing,
 * and canonical mapping. It must be impossible to register outside `test`.
 */
export function createFakePaymentProvider(): PaymentProvider {
  const observedStates = new Map<string, PaymentDomainState>();
  const failingRefunds = new Set<string>();
  return {
    code: "fake",
    async createPayment(input) {
      return {
        ok: true,
        providerReference: `fake_pay_${input.idempotencyKey}`,
        actionType: "REDIRECT",
        redirectUrl: `https://fake.pay.example/checkout/${encodeURIComponent(input.idempotencyKey)}?return=${encodeURIComponent(input.returnUrl)}`,
        clientToken: null,
        expiresAt: Date.now() + 15 * 60 * 1000,
      };
    },
    async verifyAndParseEvent(headers, rawBody) {
      const signature = headers.get("x-fake-signature");
      const timestamp = Number(headers.get("x-fake-timestamp"));
      if (!signature) {
        return {
          ok: false,
          reason: "INVALID_SIGNATURE",
        } satisfies ProviderEventVerificationFailure;
      }
      if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
        return {
          ok: false,
          reason: "INVALID_TIMESTAMP",
        } satisfies ProviderEventVerificationFailure;
      }
      const expected = await sha256Hex(`${FAKE_SHARED_SECRET}:${rawBody}`);
      if (signature !== expected) {
        return {
          ok: false,
          reason: "INVALID_SIGNATURE",
        } satisfies ProviderEventVerificationFailure;
      }
      let parsed: {
        eventId?: string;
        reference?: string;
        vendorState?: string;
        amountMinor?: number;
        currency?: string;
      };
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return {
          ok: false,
          reason: "UNPARSEABLE_PAYLOAD",
        } satisfies ProviderEventVerificationFailure;
      }
      const canonicalState =
        parsed.vendorState === "__observed__" && parsed.reference
          ? (observedStates.get(parsed.reference) ?? null)
          : mapVendorState(parsed.vendorState ?? "");
      if (
        !parsed.eventId ||
        !parsed.reference ||
        !canonicalState ||
        typeof parsed.amountMinor !== "number"
      ) {
        return {
          ok: false,
          reason: "UNKNOWN_EVENT_TYPE",
        } satisfies ProviderEventVerificationFailure;
      }
      return {
        ok: true,
        event: {
          provider: "fake",
          providerEventId: parsed.eventId,
          providerReference: parsed.reference,
          observedAt: timestamp,
          canonicalState,
          amountMinor: parsed.amountMinor,
          currency: parsed.currency ?? "PHP",
          payloadHash: await sha256Hex(rawBody),
        },
      } satisfies ProviderEventVerificationSuccess;
    },
    async getPayment(providerReference): Promise<ProviderPaymentView | null> {
      if (!providerReference.startsWith("fake_pay_")) return null;
      return {
        providerReference,
        canonicalState: observedStates.get(providerReference) ?? "PROCESSING",
        amountMinor: 0,
        currency: "PHP",
      };
    },
    async requestRefund(input) {
      if (failingRefunds.has(input.providerReference)) {
        return { ok: false, errorCode: "PROVIDER_REFUND_REJECTED" };
      }
      return {
        ok: true,
        providerRefundReference: `fake_refund_${input.refundProviderIdempotencyKey}`,
      };
    },
  };
}

export const fakeProviderTestSecret = FAKE_SHARED_SECRET;
export async function fakeSignatureFor(rawBody: string): Promise<string> {
  return sha256Hex(`${FAKE_SHARED_SECRET}:${rawBody}`);
}
