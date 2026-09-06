import type { DeliveryProvider } from "../ports/delivery-provider";

/** Deterministic test-only provider. Runtime composition forbids it outside test. */
export function createMockDeliveryProvider(now: () => number = Date.now): DeliveryProvider {
  return {
    code: "lalamove",
    capabilities: {
      immediateQuotation: true,
      scheduledQuotation: {
        supported: true,
        maximumAdvanceMilliseconds: 30 * 24 * 60 * 60 * 1_000,
      },
      createDelivery: true,
      retrieveDelivery: true,
      cancelDelivery: true,
      signedStatusWebhooks: true,
      requiresPackageDimensions: false,
    },
    async quote(request) {
      const quotedAt = now();
      return {
        ok: true,
        providerRequestId: `mock-delivery-request-${quotedAt}`,
        value: [
          {
            providerQuotationId: `mock-delivery-quote-${quotedAt}`,
            serviceType: request.serviceType,
            amountMinor: 5_000,
            currency: request.currencyCode,
            expiresAt: new Date(quotedAt + 5 * 60_000).toISOString(),
            estimatedPickupAt: request.schedule?.pickupFrom ?? null,
            estimatedDropoffAt: null,
            distanceMeters: 5_000,
          },
        ],
      };
    },
    async create(request) {
      return {
        ok: true,
        value: {
          providerDeliveryId: `mock-delivery-${request.merchantOrderId}`,
          merchantOrderId: request.merchantOrderId,
          status: "ALLOCATING",
          trackingUrl: null,
          pickupPin: null,
          quote: null,
        },
      };
    },
    async get() {
      return { ok: true, value: null };
    },
    async cancel() {
      return { ok: true, value: null };
    },
  };
}
