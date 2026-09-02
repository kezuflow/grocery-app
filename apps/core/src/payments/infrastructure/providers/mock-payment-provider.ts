import type {
  ProviderAuthorizationAction,
  ProviderAuthorizationView,
  ProviderEventVerificationFailure,
  ProviderEventVerificationSuccess,
  PaymentProvider,
  ProviderPaymentView,
  ProviderSettlementObservation,
} from "../../ports/payment-provider";
import type { PaymentDomainState } from "../../domain/payment";
import { validateSettlement } from "../../domain/settlement";

const mockObservedStates = new WeakMap<PaymentProvider, Map<string, PaymentDomainState>>();
const mockFailingRefunds = new WeakMap<PaymentProvider, Set<string>>();
const mockAuthorizationOutcomes = new WeakMap<
  PaymentProvider,
  Map<string, ProviderAuthorizationView>
>();

/** Test control: pin the state a provider lookup observes for a reference. */
export function setMockObservedState(
  provider: PaymentProvider,
  reference: string,
  state: PaymentDomainState,
): void {
  const states = mockObservedStates.get(provider);
  if (!states) throw new Error("Not the mock provider");
  states.set(reference, state);
}

/** Test control: pin the authorization outcome a provider lookup reports. */
export function setMockAuthorizationOutcome(
  provider: PaymentProvider,
  providerAuthorizationReference: string,
  outcome: ProviderAuthorizationView,
): void {
  const outcomes = mockAuthorizationOutcomes.get(provider);
  if (!outcomes) throw new Error("Not the mock provider");
  outcomes.set(providerAuthorizationReference, outcome);
}

/** Test control: force deterministic refund rejections for a payment reference. */
export function setMockRefundFailure(provider: PaymentProvider, reference: string): void {
  const failures = mockFailingRefunds.get(provider);
  if (!failures) throw new Error("Not the mock provider");
  failures.add(reference);
}

const MOCK_SHARED_SECRET = "mock-provider-test-secret";

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
 * Deterministic non-production provider proving payment, authorization,
 * webhook, reconciliation, expiry, failure, and refund paths without calling
 * an external payment service.
 */
export function createMockPaymentProvider(): PaymentProvider {
  const observedStates = new Map<string, PaymentDomainState>();
  const failingRefunds = new Set<string>();
  const authorizationOutcomes = new Map<string, ProviderAuthorizationView>();
  const provider: PaymentProvider = {
    code: "mock",
    async createAuthorization(input) {
      const reference = `mock_auth_${input.idempotencyKey}`;
      return {
        ok: true,
        action: {
          providerAuthorizationReference: reference,
          actionType: "REDIRECT",
          redirectUrl: `https://mock.pay.invalid/authorize/${encodeURIComponent(input.idempotencyKey)}?return=${encodeURIComponent(input.returnUrl)}`,
          clientToken: null,
          expiresAt: Date.now() + 15 * 60 * 1000,
        } satisfies ProviderAuthorizationAction,
      };
    },
    async getAuthorization(providerAuthorizationReference) {
      const pinned = authorizationOutcomes.get(providerAuthorizationReference);
      if (pinned) return { ok: true, authorization: pinned };
      if (!providerAuthorizationReference.startsWith("mock_auth_"))
        return { ok: false, errorCode: "PROVIDER_NOT_FOUND" };
      return {
        ok: true,
        authorization: {
          providerAuthorizationReference,
          recurringCapable: true,
          providerMethodRef: `mock_method_${providerAuthorizationReference}`,
          status: "ACTIVE",
        } satisfies ProviderAuthorizationView,
      };
    },
    async createPayment(input) {
      const providerReference = `mock_pay_${input.idempotencyKey}`;
      const returnUrl = new URL(input.returnUrl);
      const browserReturn = returnUrl.protocol === "http:" || returnUrl.protocol === "https:";
      const simulatorUrl = browserReturn
        ? new URL(
            `/development/mock-payments/${encodeURIComponent(providerReference)}`,
            returnUrl.origin,
          )
        : new URL(`/pay/${encodeURIComponent(providerReference)}`, "https://mock.pay.invalid");
      simulatorUrl.searchParams.set(
        "returnTo",
        browserReturn
          ? `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`
          : input.returnUrl,
      );
      return {
        ok: true,
        providerReference,
        actionType: "REDIRECT",
        redirectUrl: simulatorUrl.toString(),
        clientToken: null,
        expiresAt: Date.now() + 15 * 60 * 1000,
      };
    },
    async verifyAndParseEvent(headers, rawBody) {
      const signature = headers.get("x-mock-signature");
      const timestamp = Number(headers.get("x-mock-timestamp"));
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
      const expected = await sha256Hex(`${MOCK_SHARED_SECRET}:${rawBody}`);
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
        kind?: string;
        refundReference?: string;
        settlement?: Partial<ProviderSettlementObservation> | null;
      };
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return {
          ok: false,
          reason: "UNPARSEABLE_PAYLOAD",
          signatureVerified: true,
        } satisfies ProviderEventVerificationFailure;
      }
      const canonicalState =
        parsed.vendorState === "__observed__" && parsed.reference
          ? (observedStates.get(parsed.reference) ?? null)
          : mapVendorState(parsed.vendorState ?? "");
      const currency = parsed.currency ?? "PHP";
      let settlement: ProviderSettlementObservation | undefined;
      if (parsed.settlement !== undefined) {
        const candidate = parsed.settlement;
        if (
          candidate === null ||
          typeof candidate !== "object" ||
          typeof candidate.grossMinor !== "number" ||
          typeof candidate.processingCostMinor !== "number" ||
          typeof candidate.withholdingMinor !== "number" ||
          typeof candidate.adjustmentMinor !== "number" ||
          typeof candidate.netMinor !== "number" ||
          !validateSettlement({
            grossMinor: candidate.grossMinor,
            processingCostMinor: candidate.processingCostMinor,
            withholdingMinor: candidate.withholdingMinor,
            adjustmentMinor: candidate.adjustmentMinor,
            netMinor: candidate.netMinor,
          }) ||
          candidate.grossMinor !== parsed.amountMinor
        ) {
          return {
            ok: false,
            reason: "UNKNOWN_EVENT_TYPE",
            signatureVerified: true,
          } satisfies ProviderEventVerificationFailure;
        }
        settlement = {
          grossMinor: candidate.grossMinor,
          processingCostMinor: candidate.processingCostMinor,
          withholdingMinor: candidate.withholdingMinor,
          adjustmentMinor: candidate.adjustmentMinor,
          netMinor: candidate.netMinor,
          currency,
          observedAt: timestamp,
        };
      }
      if (
        !parsed.eventId ||
        !canonicalState ||
        typeof parsed.amountMinor !== "number" ||
        (parsed.kind === "refund" ? !parsed.refundReference : !parsed.reference)
      ) {
        return {
          ok: false,
          reason: "UNKNOWN_EVENT_TYPE",
          signatureVerified: true,
        } satisfies ProviderEventVerificationFailure;
      }
      return {
        ok: true,
        event: {
          provider: "mock",
          providerEventId: parsed.eventId,
          eventType: parsed.kind === "refund" ? "refund.updated" : "payment.updated",
          providerReference: parsed.reference ?? parsed.refundReference!,
          observedAt: timestamp,
          canonicalState,
          amountMinor: parsed.amountMinor,
          currency,
          payloadHash: await sha256Hex(rawBody),
          kind: parsed.kind === "refund" ? "refund" : "payment",
          refundReference: parsed.refundReference ?? null,
          settlement,
        },
      } satisfies ProviderEventVerificationSuccess;
    },
    async getPayment(providerReference): Promise<ProviderPaymentView | null> {
      if (!providerReference.startsWith("mock_pay_")) return null;
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
        providerRefundReference: `mock_refund_${input.refundProviderIdempotencyKey}`,
      };
    },
    async createTestEvent(input) {
      const rawBody = JSON.stringify({
        eventId: input.providerEventId,
        reference: input.providerReference,
        vendorState:
          input.outcome === "SUCCEEDED"
            ? "paid"
            : input.outcome === "FAILED"
              ? "failed"
              : "expired",
        amountMinor: input.amountMinor,
        currency: input.currency,
        ...(input.outcome === "SUCCEEDED"
          ? {
              settlement: {
                grossMinor: input.amountMinor,
                processingCostMinor: 0,
                withholdingMinor: 0,
                adjustmentMinor: 0,
                netMinor: input.amountMinor,
              },
            }
          : {}),
      });
      return {
        rawBody,
        headers: new Headers({
          "content-type": "application/json",
          "x-mock-signature": await mockSignatureFor(rawBody),
          "x-mock-timestamp": String(input.observedAt),
        }),
      };
    },
  };
  mockObservedStates.set(provider, observedStates);
  mockFailingRefunds.set(provider, failingRefunds);
  mockAuthorizationOutcomes.set(provider, authorizationOutcomes);
  return provider;
}

export const mockProviderTestSecret = MOCK_SHARED_SECRET;
export async function mockSignatureFor(rawBody: string): Promise<string> {
  return sha256Hex(`${MOCK_SHARED_SECRET}:${rawBody}`);
}
