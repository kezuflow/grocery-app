import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";

export type InventoryTransferStatus =
  | "DRAFT"
  | "IN_TRANSIT"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "RESOLVED"
  | "CANCELED";
export type InventoryTransferAction = "DISPATCH" | "RECEIVE" | "CANCEL" | "RESOLVE";
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
  sizeOptions?: ReadonlyArray<{ skuId: string; name: string }>;
  inventoryPoolId: string;
  productName: string;
  baseUnit: "GRAM" | "PIECE";
  quantityBase: number;
  acceptedBase: number;
  outstandingBase: number;
  damagedBase: number;
  shortageBase: number;
  lostBase: number;
  returnedBase: number;
};
export type InventoryTransferView = InventoryTransferSummary & {
  reason: string;
  sorting?: ReadonlyArray<{
    sortId: string;
    lineId: string;
    quantityGrams: number;
    skuName: string;
    quantity: number;
  }>;
  lines: ReadonlyArray<InventoryTransferLineView>;
  allowedActions: ReadonlyArray<InventoryTransferAction>;
  checks: ReadonlyArray<{
    checkId: string;
    lineId: string;
    acceptedBase: number;
    damagedBase: number;
    shortageBase: number;
    reason: string;
    checkedAt: number;
  }>;
  resolutions: ReadonlyArray<{
    resolutionId: string;
    lineId: string;
    quantityBase: number;
    category: InventoryTransferCategory;
    outcome: InventoryTransferOutcome;
    reason: string;
    resolvedAt: number;
  }>;
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
  lines: ReadonlyArray<{
    lineId: string;
    acceptedBase: number;
    sizeCounts?: ReadonlyArray<{ skuId: string; quantity: number }>;
    damagedBase?: number;
    shortageBase?: number;
  }>;
};
export type InventoryTransferCategory = "UNCLASSIFIED" | "DAMAGED" | "MISSING";
export type InventoryTransferOutcome = "LOSS" | "VERIFIED_RETURN";
export type ResolveInventoryTransferRequest = InventoryTransferCommandRequest & {
  lineId: string;
  quantityBase: number;
  category: InventoryTransferCategory;
  outcome: InventoryTransferOutcome;
  inspectionConfirmed?: boolean;
};
export type InventoryDistributionRequest = AuthenticatedRequest & {
  query?: string;
  cursor?: string;
  limit?: number;
};
export type InventoryDistributionPage = {
  items: ReadonlyArray<{
    inventoryPoolId: string;
    productName: string;
    baseUnit: "GRAM" | "PIECE";
    centralBase: number;
    localBase: number;
    physicalBase: number;
    reservedBase: number;
    heldBase: number;
    transitBase: number;
    damagedBase: number;
    shortageBase: number;
  }>;
  nextCursor: string | null;
};
export type SortInventoryStockRequest = AuthenticatedRequest & {
  locationId: string;
  productId: string;
  quantityGrams: number;
  sizeCounts: ReadonlyArray<{ skuId: string; quantity: number }>;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
};
export interface InventoryTransfersService {
  sortInventoryStock(request: SortInventoryStockRequest): Promise<RpcResult<{ sortId: string }>>;
  resolveInventoryTransfer(
    input: ResolveInventoryTransferRequest,
  ): Promise<RpcResult<InventoryTransferResult>>;
  listInventoryDistribution(
    input: InventoryDistributionRequest,
  ): Promise<RpcResult<InventoryDistributionPage>>;
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
