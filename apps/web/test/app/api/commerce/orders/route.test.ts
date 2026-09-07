import { beforeEach, describe, expect, it, vi } from "vitest";
const { listCustomerOrders } = vi.hoisted(() => ({ listCustomerOrders: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { CORE: {} } }));
vi.mock("@/lib/core-client/core", () => ({ coreClient: () => ({ listCustomerOrders }) }));
import { GET } from "@/app/api/commerce/orders/route";
beforeEach(() => listCustomerOrders.mockReset());
describe("customer order history route", () => {
  it("forwards bounded navigation and auth context, without accepting a customer identity", async () => {
    listCustomerOrders.mockResolvedValue({ ok: true, value: { items: [], nextCursor: null } });
    const response = await GET(
      new Request(
        "https://freshmarkets.ph/api/commerce/orders?limit=10&filter=completed&cursor=page-one&customerId=someone-else",
        { headers: { cookie: "session=one" } },
      ),
    );
    expect(listCustomerOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 10,
        filter: "completed",
        cursor: "page-one",
        headers: expect.objectContaining({ cookie: "session=one" }),
      }),
    );
    expect(listCustomerOrders.mock.calls[0]?.[0]).not.toHaveProperty("customerId");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      value: { items: [], nextCursor: null },
    });
  });
  it("rejects an unknown filter without calling Core", async () => {
    const response = await GET(
      new Request("https://freshmarkets.ph/api/commerce/orders?filter=unknown"),
    );
    expect(response.status).toBe(400);
    expect(listCustomerOrders).not.toHaveBeenCalled();
  });
});
