import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";
export type ScheduledWeekRequest = AuthenticatedRequest & {
  locationId: string;
  cycleId?: string;
  cycleCursor?: string;
  section?: "DEMAND" | "ORDERS" | "OFFERS";
  cursor?: string;
};
export type ScheduledDemandItem = {
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
        items: readonly { orderId: string; status: string; preparationStatus: string | null }[];
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
