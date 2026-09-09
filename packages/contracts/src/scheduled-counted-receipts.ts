import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";
export type RecordScheduledCountedReceiptRequest = AuthenticatedRequest & {
  locationId: string;
  cycleId: string;
  productId: string;
  receivedWeightGrams: number;
  receiptKind: "DELIVERY" | "REPLACEMENT";
  reason: string;
  idempotencyKey: string;
  lines: readonly {
    receivingSessionId: string;
    expectedVersion: number;
    acceptedBase: number;
    rejectedBase: number;
    shortageBase: number;
  }[];
};
export type ScheduledCountedReceiptView = {
  cycleName: string;
  receiptId: string;
  cycleId: string;
  productId: string;
  productName: string;
  receivedWeightGrams: number;
  receiptKind: "DELIVERY" | "REPLACEMENT";
  receivedAt: number;
  lines: readonly {
    receivingSessionId: string;
    skuId: string;
    variantName: string;
    acceptedBase: number;
    rejectedBase: number;
    shortageBase: number;
  }[];
};
export interface ScheduledCountedReceiptsService {
  recordScheduledCountedReceipt(
    request: RecordScheduledCountedReceiptRequest,
  ): Promise<RpcResult<ScheduledCountedReceiptView>>;
}
