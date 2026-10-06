import { beforeEach, expect, it, vi } from "vitest";
const { listCustomerNotifications } = vi.hoisted(() => ({ listCustomerNotifications: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { CORE: {} } }));
vi.mock("@/lib/core-client/core", () => ({ coreClient: () => ({ listCustomerNotifications }) }));
import { GET } from "@/app/api/commerce/notifications/route";
beforeEach(() => listCustomerNotifications.mockReset());
it("forwards session context, ignores caller identity and prevents private caching", async () => {
  listCustomerNotifications.mockResolvedValue({ ok: true, value: { items: [], hasMore: false } });
  const response = await GET(
    new Request("https://freshmarkets.ph/api/commerce/notifications?customerId=other&limit=999", {
      headers: { cookie: "session=one" },
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(listCustomerNotifications).toHaveBeenCalledWith({
    requestId: expect.any(String),
    headers: expect.objectContaining({ cookie: "session=one" }),
  });
  expect(listCustomerNotifications.mock.calls[0]?.[0]).not.toHaveProperty("customerId");
  expect(listCustomerNotifications.mock.calls[0]?.[0]).not.toHaveProperty("limit");
});
it("returns unauthenticated status without a private success body", async () => {
  listCustomerNotifications.mockResolvedValue({
    ok: false,
    error: { code: "UNAUTHENTICATED", message: "Sign in", requestId: "test" },
  });
  const response = await GET(new Request("https://freshmarkets.ph/api/commerce/notifications"));
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).not.toHaveProperty("value");
});
