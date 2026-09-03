import { parseRuntimeEnvironment } from "../../runtime/runtime-configuration";
import type { DeliveryProvider } from "../ports/delivery-provider";
import { createGrabExpressProvider } from "./grab-express/grab-express-provider";

export type RuntimeDeliveryProviderEnvironment = Readonly<{
  ENVIRONMENT?: string;
  DELIVERY_PROVIDER?: string;
  GRAB_EXPRESS_CLIENT_ID?: string;
  GRAB_EXPRESS_CLIENT_SECRET?: string;
}>;

/** Closed, fail-closed runtime selection for external delivery providers. */
export function buildDeliveryProvider(
  environment: RuntimeDeliveryProviderEnvironment,
): DeliveryProvider | null {
  const runtime = parseRuntimeEnvironment(environment.ENVIRONMENT);
  if (!environment.DELIVERY_PROVIDER || environment.DELIVERY_PROVIDER === "disabled") return null;
  if (environment.DELIVERY_PROVIDER !== "grab-express")
    throw new Error("DELIVERY_PROVIDER_INVALID");
  if (!environment.GRAB_EXPRESS_CLIENT_ID) throw new Error("GRAB_EXPRESS_CLIENT_ID_REQUIRED");
  if (!environment.GRAB_EXPRESS_CLIENT_SECRET)
    throw new Error("GRAB_EXPRESS_CLIENT_SECRET_REQUIRED");
  return createGrabExpressProvider({
    clientId: environment.GRAB_EXPRESS_CLIENT_ID,
    clientSecret: environment.GRAB_EXPRESS_CLIENT_SECRET,
    environment: runtime === "production" ? "production" : "sandbox",
  });
}
