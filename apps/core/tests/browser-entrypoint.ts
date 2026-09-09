import { CoreEntrypoint } from "../src/index";

export { CoreEntrypoint };

/** Test-only clock trigger: run the real scheduler at wall-clock time, never mutate fixtures. */
export default class BrowserEntrypoint extends CoreEntrypoint {
  override async fetch(request: Request): Promise<Response> {
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
