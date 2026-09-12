import { env } from "cloudflare:workers";
import { CheckoutClient } from "./checkout-client";
import { googleMapsBrowserConfiguration } from "@/lib/maps/google-maps-runtime";

export default function CheckoutPage() {
  const googleMaps = googleMapsBrowserConfiguration(env);
  return <CheckoutClient browserApiKey={googleMaps.browserApiKey} mapId={googleMaps.mapId} />;
}
