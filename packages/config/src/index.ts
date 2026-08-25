export const APP_NAME = "FreshMarkets" as const;
export const DEFAULT_MARKET_TIMEZONE = "Asia/Manila" as const;
export const DEFAULT_MARKET_CODE = "metro-cebu" as const;

export type RuntimeEnvironment = "development" | "preview" | "staging" | "production";

export function runtimeEnvironment(value: string | undefined): RuntimeEnvironment {
  if (value === "preview" || value === "staging" || value === "production") return value;
  return "development";
}
