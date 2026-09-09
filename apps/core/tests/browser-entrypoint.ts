import { CoreEntrypoint } from "../src/index";
import { handleLalamoveWebhook } from "../src/delivery/http/lalamove-webhook";

export { CoreEntrypoint };

/** Test-only clock trigger: run the real scheduler at wall-clock time, never mutate fixtures. */
export default class BrowserEntrypoint extends CoreEntrypoint {
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
