import { describe, expect, it, vi } from "vitest";
const createOrderAmendment = vi.fn().mockResolvedValue({ ok: true, value: {} });
vi.mock("cloudflare:workers", () => ({ env: { CORE: {} } }));
vi.mock("@/lib/core-client/core", () => ({ coreClient: () => ({ createOrderAmendment }) }));
vi.mock("@/lib/core-client/commands", () => ({ requireIdempotencyKey: () => "amend-key" }));
import { POST } from "./route";

describe("amendment route", () => {
  it("forwards bounded additive lines", async () => {
    const response = await POST(
      new Request("https://x/amend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedOrderVersion: 4,
          additions: [{ skuId: "sku-1", quantity: 2 }],
        }),
      }),
      { params: Promise.resolve({ "order-id": "order-1" }) },
    );
    expect(response.status).toBe(200);
    expect(createOrderAmendment).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        expectedOrderVersion: 4,
        idempotencyKey: "amend-key",
      }),
    );
  });
});
