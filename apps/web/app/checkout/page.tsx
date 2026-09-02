import { env } from "cloudflare:workers";
import { CheckoutClient } from "./checkout-client";

export default function CheckoutPage() {
  return <CheckoutClient publicAccessToken={env.MAPBOX_BROWSER_TOKEN || undefined} />;
}
