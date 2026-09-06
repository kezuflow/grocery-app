import { parseRuntimeEnvironment } from "../../runtime/runtime-configuration";
import type { DeliveryProvider } from "../ports/delivery-provider";
import { createLalamoveProvider } from "./lalamove/lalamove-provider";
import { createMockDeliveryProvider } from "./mock-delivery-provider";

export type DeliveryProviderCode = "lalamove" | "grab-express";

export type InstantDeliveryPartner = Readonly<{
  providerCode: DeliveryProviderCode;
  displayName: string;
  serviceType: string;
  serviceLabel: string;
}>;

export type RuntimeDeliveryProviderEnvironment = Readonly<{
  ENVIRONMENT?: string;
  /** Legacy single-provider selector retained during rollout. */
  DELIVERY_PROVIDER?: string;
  /** Ordered comma-separated provider registry used by Instant checkout. */
  DELIVERY_PROVIDERS?: string;
  GRAB_EXPRESS_CLIENT_ID?: string;
  GRAB_EXPRESS_CLIENT_SECRET?: string;
  GRAB_EXPRESS_SERVICE_TYPE?: string;
  LALAMOVE_API_KEY?: string;
  LALAMOVE_API_SECRET?: string;
  LALAMOVE_MARKET?: string;
  LALAMOVE_LANGUAGE?: string;
  LALAMOVE_SERVICE_TYPE?: string;
  LOCAL_DELIVERY_PROVIDER?: string;
}>;

const providerNames: Record<DeliveryProviderCode, string> = {
  lalamove: "Lalamove",
  "grab-express": "GrabExpress",
};

function providerCodes(environment: RuntimeDeliveryProviderEnvironment): DeliveryProviderCode[] {
  const configured = environment.DELIVERY_PROVIDERS ?? environment.DELIVERY_PROVIDER ?? "disabled";
  if (configured.trim() === "" || configured.trim() === "disabled") return [];
  const values = configured.split(",").map((value) => value.trim());
  if (
    values.some((value) => value !== "lalamove" && value !== "grab-express") ||
    new Set(values).size !== values.length
  )
    throw new Error("DELIVERY_PROVIDERS_INVALID");
  if (values.includes("grab-express")) throw new Error("GRAB_EXPRESS_NOT_VERIFIED_FOR_CEBU");
  return values as DeliveryProviderCode[];
}

function required(value: string | undefined, code: string): string {
  if (!value?.trim()) throw new Error(code);
  return value.trim();
}

function serviceLabel(serviceType: string): string {
  return serviceType
    .toLowerCase()
    .split(/[_-]+/)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/** Public-safe partner metadata for the ordered Instant checkout selector. */
export function configuredInstantDeliveryPartners(
  environment: RuntimeDeliveryProviderEnvironment,
): readonly InstantDeliveryPartner[] {
  return providerCodes(environment).map((providerCode) => {
    const serviceType =
      providerCode === "lalamove"
        ? required(environment.LALAMOVE_SERVICE_TYPE, "LALAMOVE_SERVICE_TYPE_REQUIRED")
        : required(environment.GRAB_EXPRESS_SERVICE_TYPE, "GRAB_EXPRESS_SERVICE_TYPE_REQUIRED");
    return {
      providerCode,
      displayName: providerNames[providerCode],
      serviceType,
      serviceLabel: serviceLabel(serviceType),
    };
  });
}

/** Closed, fail-closed runtime registry for all enabled external delivery providers. */
export function buildDeliveryProviderRegistry(
  environment: RuntimeDeliveryProviderEnvironment,
): ReadonlyMap<DeliveryProviderCode, DeliveryProvider> {
  const runtime = parseRuntimeEnvironment(environment.ENVIRONMENT);
  const providers = new Map<DeliveryProviderCode, DeliveryProvider>();
  for (const code of providerCodes(environment)) {
    if (runtime !== "test" && environment.LOCAL_DELIVERY_PROVIDER)
      throw new Error("LOCAL_DELIVERY_PROVIDER_FORBIDDEN");
    if (
      environment.LOCAL_DELIVERY_PROVIDER &&
      environment.LOCAL_DELIVERY_PROVIDER !== "mock"
    )
      throw new Error("LOCAL_DELIVERY_PROVIDER_INVALID");
    const provider =
      runtime === "test" && environment.LOCAL_DELIVERY_PROVIDER === "mock"
        ? createMockDeliveryProvider()
        : createLalamoveProvider({
      apiKey: required(environment.LALAMOVE_API_KEY, "LALAMOVE_API_KEY_REQUIRED"),
      apiSecret: required(environment.LALAMOVE_API_SECRET, "LALAMOVE_API_SECRET_REQUIRED"),
      market: required(environment.LALAMOVE_MARKET, "LALAMOVE_MARKET_REQUIRED"),
      language: required(environment.LALAMOVE_LANGUAGE, "LALAMOVE_LANGUAGE_REQUIRED"),
      environment: runtime === "production" ? "production" : "sandbox",
          });
    providers.set(code, provider);
  }
  return providers;
}

/** Legacy single-provider composition retained for existing dispatch callers. */
export function buildDeliveryProvider(
  environment: RuntimeDeliveryProviderEnvironment,
): DeliveryProvider | null {
  const entries = [...buildDeliveryProviderRegistry(environment).values()];
  if (entries.length > 1) throw new Error("DELIVERY_PROVIDER_AMBIGUOUS");
  return entries[0] ?? null;
}
