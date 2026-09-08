import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";
export type ProductMediaRecoveryAction = "OBSERVE_UPLOAD" | "DISCARD_UPLOAD" | "RETRY_CLEANUP";
export type ProductMediaRecoveryResult = {
  itemId: string;
  kind: "UPLOAD" | "CLEANUP";
  status: "PENDING" | "UNKNOWN" | "STORED" | "ABANDONED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
  version: number;
};
export type ProductMediaRecoveryView = {
  productId: string;
  nextCursor: string | null;
  items: Array<
    ProductMediaRecoveryResult & {
      label: string;
      createdAt: number;
      updatedAt: number;
      attempts: number;
      availableAt: number | null;
      errorCode: string | null;
      allowedActions: ProductMediaRecoveryAction[];
    }
  >;
};
export type RecoverProductMediaRequest = AuthenticatedRequest & {
  productId: string;
  itemId: string;
  action: ProductMediaRecoveryAction;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
};
export type ProductMediaRecoveryService = {
  getAdminProductMediaRecovery(
    request: AuthenticatedRequest & { productId: string; cursor?: string },
  ): Promise<RpcResult<ProductMediaRecoveryView>>;
  recoverAdminProductMedia(
    request: RecoverProductMediaRequest,
  ): Promise<RpcResult<ProductMediaRecoveryResult>>;
};
