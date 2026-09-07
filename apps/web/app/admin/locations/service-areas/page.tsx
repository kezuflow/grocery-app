import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { coreRequestHeaders } from "@/lib/core-client/request";
import { ServiceAreasWorkspace } from "@/components/admin/service-areas-workspace";
export default async function ServiceAreasPage() {
  const initial = await coreClient(env.CORE).getAdminServiceability({
    headers: coreRequestHeaders(await headers()),
    requestId: crypto.randomUUID(),
  });
  return (
    <ServiceAreasWorkspace
      initial={initial}
      publicAccessToken={env.MAPBOX_BROWSER_TOKEN || undefined}
    />
  );
}
