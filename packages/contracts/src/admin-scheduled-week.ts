import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";
export type ScheduledWeekRequest = AuthenticatedRequest & {
  /** Omit only for the Global consolidated purchase view. */
  locationId?: string;
  cycleId?: string;
  cycleCursor?: string;
  requirementId?: string;
  section?: "DEMAND" | "ORDERS" | "OFFERS";
  cursor?: string;
};
export type ScheduledDemandItem = {
  locationId: string;
  locationName: string;
  totalQuantityBase: number;
  totalQuantitySellable: number;
  skuId: string;
  inventoryPoolId: string;
  productName: string;
  variantName: string;
  quantitySellable: number;
  quantityBase: number;
  baseUnit: string;
  shippingGrams: number;
  requirementId: string | null;
  requirementVersion: number;
  status: string;
  acceptedBase: number;
  rejectedBase: number;
  shortageBase: number;
  replacementBase: number;
  receivingStatus: string | null;
  canConfirmPurchase: boolean;
};
export type ScheduledWeekView = {
  cycles: readonly { cycleId: string; name: string; status: string }[];
  nextCycleCursor: string | null;
  week: {
    cycleId: string;
    name: string;
    status: string;
    timezone: string;
    orderOpensAt: number;
    cutoffAt: number;
    purchaseBlockedReason: string | null;
    procurementAt: number | null;
    preparationAt: number | null;
    pickupAt: number | null;
    windows: readonly { name: string; startsAt: number; endsAt: number }[];
  } | null;
  page:
    | { kind: "DEMAND"; items: readonly ScheduledDemandItem[]; nextCursor: string | null }
    | {
        kind: "ORDERS";
        denied: boolean;
        requirement: {
          id: string;
          productName: string;
          variantName: string;
          baseUnit: string;
        } | null;
        items: readonly {
          orderId: string;
          status: string;
          preparationStatus: string | null;
          openQuantityBase: number | null;
          cancellationStatus: string | null;
        }[];
        nextCursor: string | null;
      }
    | {
        kind: "OFFERS";
        items: readonly {
          skuId: string;
          productName: string;
          variantName: string;
          priceMinor: number | null;
          currency: string | null;
        }[];
        nextCursor: string | null;
      };
};
export interface AdminScheduledWeekService {
  getAdminScheduledWeek(request: ScheduledWeekRequest): Promise<RpcResult<ScheduledWeekView>>;
}
