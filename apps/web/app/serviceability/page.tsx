import { env } from "cloudflare:workers";
import { ServiceabilityClient } from "./serviceability-client";
import { googleMapsBrowserConfiguration } from "@/lib/maps/google-maps-runtime";

export default function ServiceabilityPage() {
  const googleMaps = googleMapsBrowserConfiguration(env);
  return <ServiceabilityClient browserApiKey={googleMaps.browserApiKey} mapId={googleMaps.mapId} />;
}
