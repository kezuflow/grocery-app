import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { coreRequestHeaders } from "@/lib/core-client/request";
import { ServiceAreasWorkspace } from "@/components/admin/service-areas-workspace";
import { googleMapsBrowserConfiguration } from "@/lib/maps/google-maps-runtime";

export default async function ServiceAreasPage() {
  const googleMaps = googleMapsBrowserConfiguration(env);
  const initial = await coreClient(env.CORE).getAdminServiceability({
    headers: coreRequestHeaders(await headers()),
    requestId: crypto.randomUUID(),
  });
  return (
    <ServiceAreasWorkspace
      initial={initial}
      browserApiKey={googleMaps.browserApiKey}
      mapId={googleMaps.mapId}
    />
  );
}
