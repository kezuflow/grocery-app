import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { coreRequestHeaders } from "@/lib/core-client/request";
import { LocationScheduleWorkspace } from "@/components/admin/location-schedule-workspace";
export default async function LocationSchedulePage({
  params,
}: {
  params: Promise<{ "location-id": string }>;
}) {
  const { "location-id": locationId } = await params;
  const initial = await coreClient(env.CORE).getAdminLocationSchedule({
    headers: coreRequestHeaders(await headers()),
    requestId: crypto.randomUUID(),
    locationId,
  });
  return <LocationScheduleWorkspace initial={initial} locationId={locationId} />;
}
