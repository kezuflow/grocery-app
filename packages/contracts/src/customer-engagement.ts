import type { AuthenticatedRequest } from "./auth";
import type { RpcResult } from "./common";

export type SavedProductView = {
  productId: string;
  slug: string;
  name: string;
  savedAt: string;
};

export type PopularWithCartProductView = { productId: string; slug: string; name: string };

export type SetSavedProductRequest = AuthenticatedRequest & {
  productId: string;
  saved: boolean;
};

export type OrderFeedbackView = {
  orderId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment: string | null;
  submittedAt: string;
};

export type OrderFeedbackRequest = AuthenticatedRequest & { orderId: string };
export type SubmitOrderFeedbackRequest = OrderFeedbackRequest & {
  rating: OrderFeedbackView["rating"];
  comment: string | null;
};

export type CustomerEngagementService = {
  listSavedProducts(request: AuthenticatedRequest): Promise<RpcResult<readonly SavedProductView[]>>;
  listPopularWithCart(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<readonly PopularWithCartProductView[]>>;
  setSavedProduct(request: SetSavedProductRequest): Promise<RpcResult<{ saved: boolean }>>;
  getOrderFeedback(request: OrderFeedbackRequest): Promise<RpcResult<OrderFeedbackView | null>>;
  submitOrderFeedback(request: SubmitOrderFeedbackRequest): Promise<RpcResult<OrderFeedbackView>>;
};
