import { env } from "cloudflare:workers";
import { DispatchMap } from "../../../components/admin/delivery/dispatch-map";

export default function DeliveryPage() {
  return <DispatchMap publicAccessToken={env.MAPBOX_BROWSER_TOKEN || undefined} />;
}
