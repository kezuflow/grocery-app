import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  env: {
    GOOGLE_MAPS_BROWSER_KEY: "browser-key",
    GOOGLE_MAPS_MAP_ID: "map-id",
    GOOGLE_MAPS_SERVER_KEY: "server-key-must-not-cross",
  },
}));
vi.mock("@/components/admin/delivery/dispatch-map", () => ({ DispatchMap: () => null }));
vi.mock("@/components/admin/delivery/external-delivery-queue", () => ({
  ExternalDeliveryQueue: () => null,
}));
vi.mock("@/components/admin/delivery/location-delivery-profile-panel", () => ({
  LocationDeliveryProfilePanel: () => null,
}));

import DeliveryPage from "@/app/admin/delivery/page";

describe("Google Maps key security boundary", () => {
  it("does not expose map credentials from the external-only Delivery page", () => {
    const page = DeliveryPage() as { props: Record<string, unknown> };
    expect(JSON.stringify(page.props)).not.toContain("server-key-must-not-cross");
    expect(JSON.stringify(page.props)).not.toContain("browser-key");
    expect(page.props).not.toHaveProperty("GOOGLE_MAPS_SERVER_KEY");
  });
});
