import type { RpcResult } from "./common";
import type { AuthenticatedRequest } from "./auth";
import type {
  DeliveryJobState,
  FulfillmentState,
  ImplementedOrderState,
  PaymentState,
  RefundState,
} from "./states";

export type CustomerOrderView = {
  id: string;
  orderNumber: string;
  status: ImplementedOrderState;
  fulfillmentMode: "INSTANT" | "SCHEDULED";
  deliveryDate: string | null;
  promisedAt: string | null;
  committedAt: string;
  totalMinor: number;
  currency: string;
  itemCount: number;
};

export type CustomerOrderLineSnapshot = {
  orderItemId: string;
  skuId: string;
  productName: string;
  variantName: string;
  unit: string;
  quantity: number;
  baseQuantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
};

export type CustomerOrderFinancialView = {
  source: "CHECKOUT_QUOTE" | "AMENDMENT_QUOTE" | "ORDER_TOTAL_ONLY";
  currency: string;
  merchandiseSubtotalMinor: number | null;
  itemDiscountMinor: number | null;
  orderDiscountMinor: number | null;
  deliverySubtotalMinor: number | null;
  deliveryFeeMinor: number | null;
  deliveryDiscountMinor: number | null;
  serviceFeeMinor: number | null;
  taxMinor: number | null;
  totalMinor: number;
};

export type CustomerTimelineEntry = {
  eventId: string;
  type:
    | "ORDER_COMMITTED"
    | "PAYMENT_STATUS"
    | "FULFILLMENT_STATUS"
    | "DELIVERY_STATUS"
    | "AMENDMENT_STATUS"
    | "REFUND_STATUS"
    | "ISSUE_STATUS";
  title: string;
  description: string;
  status: string;
  occurredAt: string;
};

export type CustomerOrderActionView = {
  action: "REORDER" | "SUBMIT_ISSUE" | "REQUEST_AMENDMENT" | "VIEW_INVOICE" | "CANCEL";
  available: boolean;
  disabledReason: string | null;
};

export type CustomerOrderDetailView = {
  orderId: string;
  orderNumber: string;
  status: ImplementedOrderState;
  version: number;
  committedAt: string;
  financial: CustomerOrderFinancialView;
  items: readonly CustomerOrderLineSnapshot[];
  fulfillment: {
    mode: "INSTANT" | "SCHEDULED";
    status: FulfillmentState | null;
    deliveryStatus: DeliveryJobState | null;
    cycleId: string | null;
    deliveryDate: string | null;
    promisedAt: string | null;
    address: {
      label: string | null;
      recipient: string | null;
      phone: string | null;
      addressLine1: string | null;
      addressLine2: string | null;
      barangay: string | null;
      city: string | null;
      region: string | null;
      postalCode: string | null;
      countryCode: string | null;
      deliveryNote: string | null;
    };
  };
  payments: readonly {
    paymentId: string;
    purpose: "GROCERY_CHECKOUT" | "ORDER_AMENDMENT";
    status: PaymentState;
    amountMinor: number;
    currency: string;
    createdAt: string;
    updatedAt: string;
  }[];
  refunds: readonly {
    refundId: string;
    status: RefundState;
    amountMinor: number;
    currency: string;
    createdAt: string;
    updatedAt: string;
  }[];
  amendments: readonly {
    amendmentId: string;
    status: "DRAFT" | "PENDING_PAYMENT" | "COMMITTED" | "FAILED" | "CANCELED";
    version: number;
    financial: CustomerOrderFinancialView;
    lines: readonly CustomerOrderLineSnapshot[];
    committedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
  issues: readonly CustomerOrderIssueView[];
  invoice: {
    status: "NOT_AVAILABLE" | "NOT_READY" | "READY" | "ISSUED";
    invoiceIdentifier: string | null;
    issuedAt: string | null;
  };
  timeline: readonly CustomerTimelineEntry[];
  actions: readonly CustomerOrderActionView[];
};

export type CustomerOrderDetailRequest = AuthenticatedRequest & { orderId: string };

export type ReorderSkippedReason =
  | "SKU_INACTIVE"
  | "PRODUCT_INACTIVE"
  | "LOCATION_UNAVAILABLE"
  | "PRICE_UNAVAILABLE"
  | "INVALID_HISTORICAL_QUANTITY";

export type ReorderResultView = {
  outcome: "COMPLETE" | "PARTIAL" | "NO_ITEMS_ADDED";
  cartId: string;
  newCartVersion: number;
  addedLines: readonly {
    skuId: string;
    name: string;
    quantityAdded: number;
    newQuantity: number;
    currentUnitPriceMinor: number;
    currency: string;
  }[];
  skippedLines: readonly {
    skuId: string;
    productName: string;
    quantity: number;
    reason: ReorderSkippedReason;
  }[];
  requiresFulfillmentReview: true;
  requiresAddressReview: true;
};

export type ReorderOrderRequest = AuthenticatedRequest & {
  orderId: string;
  expectedCartVersion: number;
  idempotencyKey: string;
};

export const customerOrderIssueCategories = [
  "MISSING_ITEM",
  "WRONG_ITEM",
  "DAMAGED_ITEM",
  "POOR_QUALITY",
  "QUANTITY_DISCREPANCY",
  "DELIVERY_ISSUE",
  "OTHER",
] as const;
export type CustomerOrderIssueCategory = (typeof customerOrderIssueCategories)[number];

export type CustomerOrderIssueStatus = "SUBMITTED" | "IN_REVIEW" | "RESOLVED" | "ESCALATED";

export type CustomerOrderIssueView = {
  issueId: string;
  orderId: string;
  category: CustomerOrderIssueCategory;
  status: CustomerOrderIssueStatus;
  description: string;
  affectedOrderItemIds: readonly string[];
  resolutionMessage: string | null;
  terminal: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SubmitCustomerOrderIssueRequest = AuthenticatedRequest & {
  orderId: string;
  category: CustomerOrderIssueCategory;
  description: string;
  affectedOrderItemIds: readonly string[];
  idempotencyKey: string;
};

export type ListCustomerOrderIssuesRequest = AuthenticatedRequest & { orderId: string };

export type OrderAmendmentDraftView = {
  amendmentId: string;
  orderId: string;
  status: "DRAFT" | "PENDING_PAYMENT" | "COMMITTED" | "FAILED" | "CANCELED";
  version: number;
  financial: CustomerOrderFinancialView;
  lines: readonly CustomerOrderLineSnapshot[];
};

export type CreateOrderAmendmentRequest = AuthenticatedRequest & {
  orderId: string;
  expectedOrderVersion: number;
  additions: readonly { skuId: string; quantity: number }[];
  idempotencyKey: string;
};

export type AdminOrderCommandRequest = AuthenticatedRequest & {
  orderId: string;
  action: "CANCEL" | "REFUND";
  reason: string;
  idempotencyKey: string;
  expectedVersion: number;
};

export type OrdersService = {
  listCustomerOrders(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<ReadonlyArray<CustomerOrderView>>>;
  getCustomerOrderDetail(
    request: CustomerOrderDetailRequest,
  ): Promise<RpcResult<CustomerOrderDetailView>>;
  reorderOrder(request: ReorderOrderRequest): Promise<RpcResult<ReorderResultView>>;
  submitCustomerOrderIssue(
    request: SubmitCustomerOrderIssueRequest,
  ): Promise<RpcResult<CustomerOrderIssueView>>;
  listCustomerOrderIssues(
    request: ListCustomerOrderIssuesRequest,
  ): Promise<RpcResult<readonly CustomerOrderIssueView[]>>;
  createOrderAmendment(
    request: CreateOrderAmendmentRequest,
  ): Promise<RpcResult<OrderAmendmentDraftView>>;
};
