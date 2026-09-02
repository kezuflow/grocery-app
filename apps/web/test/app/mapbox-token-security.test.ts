import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  env: {
    MAPBOX_BROWSER_TOKEN: "pk.browser-public",
    MAPBOX_ACCESS_TOKEN: "sk.core-server-secret",
  },
}));
vi.mock("@/components/admin/delivery/dispatch-map", () => ({
  DispatchMap: () => null,
}));

import DeliveryPage from "@/app/admin/delivery/page";

describe("Mapbox browser token security boundary", () => {
  it("passes only the browser-public token into the Admin map component", () => {
    const page = DeliveryPage() as { props: Record<string, unknown> };

    expect(page.props).toEqual({ publicAccessToken: "pk.browser-public" });
    expect(JSON.stringify(page.props)).not.toContain("sk.core-server-secret");
    expect(page.props).not.toHaveProperty("MAPBOX_ACCESS_TOKEN");
  });
});
