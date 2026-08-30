import type { RoutePreviewPort } from "../ports/route-preview";
import { MapboxRoutePreview } from "./mapbox-route-preview";

export function buildRoutePreviewPort(
  environment: { MAPBOX_ACCESS_TOKEN?: string },
  fetchImpl: typeof fetch = fetch,
): RoutePreviewPort {
  return new MapboxRoutePreview(environment.MAPBOX_ACCESS_TOKEN ?? "", fetchImpl);
}
