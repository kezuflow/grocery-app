import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { coreRequestHeaders } from "@/lib/core-client/request";
import { LocationFulfillmentWorkspace } from "@/components/admin/location-fulfillment-workspace";
export default async function LocationFulfillmentPage({
  params,
}: {
  params: Promise<{ "location-id": string }>;
}) {
  const { "location-id": locationId } = await params;
  const initial = await coreClient(env.CORE).getAdminLocationFulfillment({
    headers: coreRequestHeaders(await headers()),
    requestId: crypto.randomUUID(),
    locationId,
  });
  return <LocationFulfillmentWorkspace initial={initial} locationId={locationId} />;
}
