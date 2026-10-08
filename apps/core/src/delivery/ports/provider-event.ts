import type { ProviderDeliveryStatus } from "./delivery-provider";

export type ProviderEvidenceKind =
  | "DRIVER"
  | "COST"
  | "DELIVERY_PROOF"
  | "PICKUP_PROOF"
  | "DELIVERY_CODE"
  | "EDIT";
export type ProviderProof = {
  stopIndex: number;
  status: string;
  imageUrls: string[];
  occurredAt: string | null;
};
/** Normalized provider facts, never customer financial or physical-custody authority. */
export type ProviderEvent = {
  eventId: string;
  kind: "STATUS" | "DRIVER" | "REPLACEMENT" | "EVIDENCE" | "WALLET" | "CREATED" | "UNKNOWN";
  providerDeliveryId: string | null;
  observedAt: number;
  status?: ProviderDeliveryStatus;
  driverId?: string | null;
  trackingUrl?: string | null;
  previousProviderDeliveryId?: string;
  replacementCheck?: boolean;
  evidence?: { kind: ProviderEvidenceKind; value: unknown }[];
  observedStops?: readonly import("./delivery-provider").ObservedDeliveryStop[];
  merchantOrderId?: string;
};
