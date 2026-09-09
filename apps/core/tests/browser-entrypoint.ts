import { CoreEntrypoint as ProductionCoreEntrypoint } from "../src/index";
import { handleLalamoveWebhook } from "../src/delivery/http/lalamove-webhook";
import { MapboxGeocoder } from "../src/geography/infrastructure/mapbox-geocoder";
import type { GeocoderPort } from "../src/geography/ports/geocoder";

export { BrowserEntrypoint as CoreEntrypoint };

/** Test-only clock trigger: run the real scheduler at wall-clock time, never mutate fixtures. */
export default class BrowserEntrypoint extends ProductionCoreEntrypoint {
  /** Local provider transport only; production validation/application still run. */
  protected override createGeocoderPort = (): GeocoderPort => {
    if (String(this.env.ENVIRONMENT) !== "test")
      throw new Error("Test provider requires test mode");
    return new MapboxGeocoder("synthetic-geocoder-token", async (input) => {
      const url = new URL(String(input));
      if (
        url.pathname !== "/search/geocode/v6/reverse" ||
        url.searchParams.get("permanent") !== "true"
      )
        throw new Error("Browsing confirmation requires permanent reverse geocoding");
      return Response.json({
        features: [
          {
            type: "Feature",
            id: "synthetic-confirmed-address",
            geometry: {
              type: "Point",
              coordinates: [
                Number(url.searchParams.get("longitude")),
                Number(url.searchParams.get("latitude")),
              ],
            },
            properties: {
              mapbox_id: "synthetic-confirmed-address",
              feature_type: "address",
              name: "Confirmed delivery entrance",
              full_address: "Confirmed delivery entrance, Cebu",
              context: {
                place: { name: "Cebu" },
                country: { name: "Philippines", country_code: "PH" },
              },
            },
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
