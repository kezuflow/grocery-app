import { env } from "cloudflare:workers";
import { ServiceabilityClient } from "./serviceability-client";

export default function ServiceabilityPage() {
  return <ServiceabilityClient publicAccessToken={env.MAPBOX_BROWSER_TOKEN || undefined} />;
}
