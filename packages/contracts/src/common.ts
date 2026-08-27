export const CONTRACT_VERSION = "2026-08-27.checkout-reconciliation" as const;

export type RequestMeta = {
  requestId: string;
  idempotencyKey?: string;
  locale?: string;
  timezone?: string;
};

export const appErrorCodes = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "CONFLICT",
  "STALE_VERSION",
  "SUBSCRIPTION_REQUIRED",
  "ADDRESS_NOT_SERVICEABLE",
  "CYCLE_CLOSED",
  "CYCLE_FULL",
  "INSUFFICIENT_STOCK",
  "CAPACITY_UNAVAILABLE",
  "PRICE_CHANGED",
  "DELIVERY_FEE_CONFIGURATION_MISSING",
  "ROUTE_DISTANCE_UNCONFIGURED",
  "ROUTE_DISTANCE_UNAVAILABLE",
  "ROUTE_DISTANCE_TIMEOUT",
  "ROUTE_NOT_FOUND",
  "ROUTE_DISTANCE_INVALID_RESPONSE",
  "ITEM_UNAVAILABLE",
  "PROMOTION_INELIGIBLE",
  "PAYMENT_REQUIRED",
  "PAYMENT_FAILED",
  "PAYMENT_PROVIDER_UNAVAILABLE",
  "FINANCIAL_OPERATION_REQUIRES_REVIEW",
  "CONFIGURATION_ERROR",
  "ILLEGAL_TRANSITION",
  "IDEMPOTENCY_CONFLICT",
  "INTERNAL_ERROR",
] as const;

export type AppErrorCode = (typeof appErrorCodes)[number];

export type AppError = {
  code: AppErrorCode;
  message: string;
  requestId: string;
  details?: Readonly<Record<string, string>>;
};

export type RpcResult<T> =
  | { ok: true; value: T; requestId: string }
  | { ok: false; error: AppError };

export type CoreHealthResponse = {
  service: "core";
  status: "ok";
  contractVersion: typeof CONTRACT_VERSION;
  environment: string;
  databaseBindingConfigured: boolean;
  timestamp: string;
};
