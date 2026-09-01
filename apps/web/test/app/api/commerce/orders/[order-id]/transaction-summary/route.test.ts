import { beforeEach, describe, expect, it, vi } from "vitest";

const { getProvisionalTransactionSummary } = vi.hoisted(() => ({
  getProvisionalTransactionSummary: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: { CORE: {} } }));
vi.mock("@/lib/core-client/core", () => ({
  coreClient: () => ({ getProvisionalTransactionSummary }),
}));

import { GET } from "@/app/api/commerce/orders/[order-id]/transaction-summary/route";

beforeEach(() => getProvisionalTransactionSummary.mockReset());

describe("transaction summary route", () => {
  it("forwards only the order identity and session context", async () => {
    getProvisionalTransactionSummary.mockResolvedValue({ ok: true, value: {} });
    const response = await GET(
      new Request("https://freshmarkets.ph/api/commerce/orders/order-1/transaction-summary", {
        headers: { cookie: "session=one" },
      }),
      { params: Promise.resolve({ "order-id": "order-1" }) },
    );
    expect(response.status).toBe(200);
    expect(getProvisionalTransactionSummary).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order-1", headers: expect.any(Object) }),
    );
    expect(getProvisionalTransactionSummary.mock.calls[0][0]).not.toHaveProperty("customerId");
  });
});
