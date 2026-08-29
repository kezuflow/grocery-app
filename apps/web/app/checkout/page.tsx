import { env } from "cloudflare:workers";
import { CheckoutClient } from "./checkout-client";

export default function CheckoutPage() {
  return <CheckoutClient publicAccessToken={env.MAPBOX_PUBLIC_ACCESS_TOKEN || undefined} />;
}
