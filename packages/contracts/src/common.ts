export const CONTRACT_VERSION = "2026-08-30.cart-reliability" as const;

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
  "MEMBERSHIP_REQUIRED",
  "TRIAL_ENDED",
  "SUBSCRIPTION_GRACE_ENDED",
  "ADDRESS_NOT_SERVICEABLE",
  "CYCLE_CLOSED",
  "CYCLE_FULL",
  "INSUFFICIENT_STOCK",
  "INSTANT_MODE_UNAVAILABLE",
  "CAPACITY_UNAVAILABLE",
  "MINIMUM_ORDER_NOT_MET",
  "PRICE_CHANGED",
  "PRICE_UNAVAILABLE",
  "DELIVERY_FEE_CONFIGURATION_MISSING",
  "ROUTE_DISTANCE_UNCONFIGURED",
  "ROUTE_DISTANCE_UNAVAILABLE",
  "ROUTE_DISTANCE_TIMEOUT",
  "ROUTE_NOT_FOUND",
  "ROUTE_DISTANCE_INVALID_RESPONSE",
  "GEOCODER_UNCONFIGURED",
  "GEOCODER_INVALID_REQUEST",
  "GEOCODER_UNAUTHORIZED",
  "GEOCODER_RATE_LIMITED",
  "GEOCODER_TIMEOUT",
  "GEOCODER_UNAVAILABLE",
  "GEOCODER_INVALID_RESPONSE",
  "GEOCODER_NO_RESULTS",
  "ITEM_UNAVAILABLE",
  "UNAVAILABLE_ITEM",
  "PROMOTION_INELIGIBLE",
  "PAYMENT_REQUIRED",
  "PAYMENT_FAILED",
  "PAYMENT_OUTCOME_UNRESOLVED",
  "AUTHORIZATION_OUTCOME_UNRESOLVED",
  "PAYMENT_ACTION_EXPIRED",
  "QUOTE_EXPIRED",
  "AUTHORIZATION_ACTION_EXPIRED",
  "AUTHORIZATION_FAILED",
  "AUTHORIZATION_REVOKED",
  "AUTHORIZATION_PENDING",
  "AUTHORIZATION_IDENTITY_IN_USE",
  "RECURRING_AUTHORIZATION_REQUIRED",
  "RECURRING_NOT_CAPABLE",
  "PROVIDER_LOOKUP_FAILED",
  "OPEN_SUBSCRIPTION_EXISTS",
  "ADDRESS_UNSERVICEABLE",
  "REFUND_AMOUNT_UNAVAILABLE",
  "PAYMENT_PROVIDER_UNAVAILABLE",
  "FINANCIAL_OPERATION_REQUIRES_REVIEW",
  "CONFIGURATION_ERROR",
  "ILLEGAL_TRANSITION",
  "IDEMPOTENCY_CONFLICT",
  "CART_VERSION_CONFLICT",
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

/** Historical health-only entrypoint alias retained for compatibility. */
export type CoreEntrypoint = {
  health(meta?: RequestMeta): Promise<CoreHealthResponse>;
};

export type HealthService = CoreEntrypoint;
