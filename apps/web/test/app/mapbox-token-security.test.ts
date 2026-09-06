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
vi.mock("@/components/admin/delivery/external-delivery-queue", () => ({
  ExternalDeliveryQueue: () => null,
}));
vi.mock("@/components/admin/delivery/location-delivery-profile-panel", () => ({
  LocationDeliveryProfilePanel: () => null,
}));

import DeliveryPage from "@/app/admin/delivery/page";

describe("Mapbox browser token security boundary", () => {
  it("does not expose Mapbox tokens from the external-only Delivery page", () => {
    const page = DeliveryPage() as { props: Record<string, unknown> };
    expect(JSON.stringify(page.props)).not.toContain("sk.core-server-secret");
    expect(JSON.stringify(page.props)).not.toContain("pk.browser-public");
    expect(page.props).not.toHaveProperty("MAPBOX_ACCESS_TOKEN");
  });
});
