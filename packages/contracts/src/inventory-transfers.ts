import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";

export type InventoryTransferStatus =
  | "DRAFT"
  | "IN_TRANSIT"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CANCELED";
export type InventoryTransferAction = "DISPATCH" | "RECEIVE" | "CANCEL";
export type InventoryTransferSummary = {
  transferId: string;
  sourceLocationId: string;
  sourceLocationName: string;
  destinationLocationId: string;
  destinationLocationName: string;
  status: InventoryTransferStatus;
  version: number;
  lineCount: number;
  createdAt: number;
  dispatchedAt: number | null;
};
export type InventoryTransferLineView = {
  lineId: string;
  inventoryPoolId: string;
  productName: string;
  baseUnit: "GRAM" | "PIECE";
  quantityBase: number;
  acceptedBase: number;
  outstandingBase: number;
};
export type InventoryTransferView = InventoryTransferSummary & {
  reason: string;
  lines: ReadonlyArray<InventoryTransferLineView>;
  allowedActions: ReadonlyArray<InventoryTransferAction>;
  receipts: ReadonlyArray<{
    receiptId: string;
    lineId: string;
    acceptedBase: number;
    reason: string;
    receivedAt: number;
  }>;
};
export type InventoryTransferPage = {
  items: ReadonlyArray<InventoryTransferSummary>;
  nextCursor: string | null;
  canCreate: boolean;
};
export type InventoryTransferOptions = {
  sources: ReadonlyArray<{ locationId: string; name: string }>;
  destinations: ReadonlyArray<{ locationId: string; name: string }>;
  products: ReadonlyArray<{
    inventoryPoolId: string;
    productName: string;
    baseUnit: "GRAM" | "PIECE";
    onHandBase: number;
    reservedBase: number;
    heldBase: number;
    availableBase: number;
  }>;
  moreProducts: boolean;
};
export type InventoryTransferResult = {
  transferId: string;
  status: InventoryTransferStatus;
  version: number;
};
export type InventoryTransferListRequest = AuthenticatedRequest & {
  locationId?: string;
  status?: InventoryTransferStatus;
  cursor?: string;
  limit?: number;
};
export type InventoryTransferReadRequest = AuthenticatedRequest & { transferId: string };
export type InventoryTransferOptionsRequest = AuthenticatedRequest & {
  sourceLocationId?: string;
  query?: string;
};
export type CreateInventoryTransferRequest = AuthenticatedRequest & {
  sourceLocationId: string;
  destinationLocationId: string;
  reason: string;
  idempotencyKey: string;
  lines: ReadonlyArray<{ inventoryPoolId: string; quantityBase: number }>;
};
export type InventoryTransferCommandRequest = InventoryTransferReadRequest & {
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
};
export type ReceiveInventoryTransferRequest = InventoryTransferCommandRequest & {
  lines: ReadonlyArray<{ lineId: string; acceptedBase: number }>;
};
export interface InventoryTransfersService {
  listInventoryTransfers(
    input: InventoryTransferListRequest,
  ): Promise<RpcResult<InventoryTransferPage>>;
  getInventoryTransfer(
    input: InventoryTransferReadRequest,
  ): Promise<RpcResult<InventoryTransferView>>;
  getInventoryTransferOptions(
    input: InventoryTransferOptionsRequest,
  ): Promise<RpcResult<InventoryTransferOptions>>;
  createInventoryTransfer(
    input: CreateInventoryTransferRequest,
  ): Promise<RpcResult<InventoryTransferResult>>;
  dispatchInventoryTransfer(
    input: InventoryTransferCommandRequest,
  ): Promise<RpcResult<InventoryTransferResult>>;
  receiveInventoryTransfer(
    input: ReceiveInventoryTransferRequest,
  ): Promise<RpcResult<InventoryTransferResult>>;
  cancelInventoryTransfer(
    input: InventoryTransferCommandRequest,
  ): Promise<RpcResult<InventoryTransferResult>>;
}
