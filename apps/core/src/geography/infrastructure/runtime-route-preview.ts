import type { RoutePreviewPort } from "../ports/route-preview";
import { GoogleRoutesPreview } from "./google-routes-preview";

export function buildRoutePreviewPort(
  environment: { GOOGLE_MAPS_SERVER_KEY?: string },
  fetchImpl: typeof fetch = fetch,
): RoutePreviewPort {
  return new GoogleRoutesPreview(environment.GOOGLE_MAPS_SERVER_KEY ?? "", fetchImpl);
}
