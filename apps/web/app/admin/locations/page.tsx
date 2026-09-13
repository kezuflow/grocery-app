import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { coreRequestHeaders } from "@/lib/core-client/request";
import { LocationAddressStep } from "@/components/admin/location-setup-steps";
import { googleMapsBrowserConfiguration } from "@/lib/maps/google-maps-runtime";

export default async function LocationsPage() {
  const googleMaps = googleMapsBrowserConfiguration(env);
  const result = await coreClient(env.CORE).listAdminLocations({
    headers: coreRequestHeaders(await headers()),
    requestId: crypto.randomUUID(),
  });
  return (
    <LocationAddressStep
      initial={result}
      browserApiKey={googleMaps.browserApiKey}
      mapId={googleMaps.mapId}
    />
  );
}
