import { CoreEntrypoint as ProductionCoreEntrypoint } from "../src/index";
import { handleLalamoveWebhook } from "../src/delivery/http/lalamove-webhook";
import { GoogleMapsGeocoder } from "../src/geography/infrastructure/google-maps-geocoder";
import type { GeocoderPort } from "../src/geography/ports/geocoder";

export { BrowserEntrypoint as CoreEntrypoint };

/** Test-only clock trigger: run the real scheduler at wall-clock time, never mutate fixtures. */
export default class BrowserEntrypoint extends ProductionCoreEntrypoint {
  /** Local provider transport only; production validation/application still run. */
  protected override createGeocoderPort = (): GeocoderPort => {
    if (String(this.env.ENVIRONMENT) !== "test")
      throw new Error("Test provider requires test mode");
    return new GoogleMapsGeocoder("synthetic-geocoder-key", async (input) => {
      const url = new URL(String(input));
      if (url.pathname !== "/maps/api/geocode/json" || !url.searchParams.has("latlng"))
        throw new Error("Browsing confirmation requires reverse geocoding");
      const [latitude, longitude] = url.searchParams.get("latlng")!.split(",").map(Number);
      return Response.json({
        status: "OK",
        results: [
          {
            place_id: "synthetic-confirmed-address",
            formatted_address: "Confirmed delivery entrance, Cebu",
            geometry: {
              location: { lat: latitude, lng: longitude },
              location_type: "ROOFTOP",
            },
            address_components: [
              { long_name: "Confirmed delivery entrance", types: ["premise"] },
              { long_name: "Cebu", types: ["locality"] },
              { long_name: "Philippines", short_name: "PH", types: ["country"] },
            ],
          },
        ],
      });
    });
  };
  override async fetch(request: Request): Promise<Response> {
    // Exercise the production signature/inbox/application boundary with synthetic
    // credentials, never the developer's local provider account secrets.
    if (
      String(this.env.ENVIRONMENT) === "test" &&
      new URL(request.url).pathname === "/webhooks/delivery/lalamove"
    )
      return handleLalamoveWebhook(
        this.env.DB,
        {
          DELIVERY_PROVIDERS: "lalamove",
          LALAMOVE_API_KEY: "pk_browser_synthetic",
          LALAMOVE_API_SECRET: "sk_browser_synthetic",
        },
        request,
        crypto.randomUUID(),
      );
    if (new URL(request.url).pathname === "/__e2e/scheduled") {
      if (String(this.env.ENVIRONMENT) !== "test" || request.method !== "POST")
        return new Response(null, { status: 404 });
      await this.scheduled({ cron: "* * * * *" });
      await this.scheduled({ cron: "*/15 * * * *" });
      return new Response(null, { status: 204 });
    }
    return super.fetch(request);
  }
}
