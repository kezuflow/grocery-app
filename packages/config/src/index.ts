export const APP_NAME = "FreshMarkets" as const;
export const DEFAULT_MARKET_TIMEZONE = "Asia/Manila" as const;
export const DEFAULT_MARKET_CODE = "METRO_CEBU" as const;
export const DEFAULT_FULFILLMENT_LOCATION_ID = "location-cebu-central" as const;
export const DEFAULT_SUBSCRIPTION_OFFER_CODE = "TRIAL" as const;
export const DEFAULT_MINIMUM_BASKET_MINOR = 50000 as const;

export type RuntimeEnvironment = "development" | "preview" | "staging" | "production";

export function runtimeEnvironment(value: string | undefined): RuntimeEnvironment {
  if (value === "preview" || value === "staging" || value === "production") return value;
  return "development";
}
