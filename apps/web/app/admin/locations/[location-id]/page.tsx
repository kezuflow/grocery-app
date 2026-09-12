import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { coreRequestHeaders } from "@/lib/core-client/request";
import { googleMapsBrowserConfiguration } from "@/lib/maps/google-maps-runtime";
import { LocationsWorkspace } from "@/components/admin/locations-workspace";

export default async function LocationPage({
  params,
}: {
  params: Promise<{ "location-id": string }>;
}) {
  const { "location-id": locationId } = await params;
  const initial = await coreClient(env.CORE).listAdminLocations({
    headers: coreRequestHeaders(await headers()),
    requestId: crypto.randomUUID(),
    locationId,
  });
  return (
    <LocationsWorkspace
      initial={initial}
      detailLocationId={locationId}
      {...googleMapsBrowserConfiguration(env)}
    />
  );
}
