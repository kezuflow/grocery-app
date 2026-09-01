import { beforeEach, describe, expect, it, vi } from "vitest";

const { abandonCheckoutAttempt } = vi.hoisted(() => ({ abandonCheckoutAttempt: vi.fn() }));
const requireIdempotencyKey = vi.fn();
vi.mock("cloudflare:workers", () => ({ env: { CORE: {} } }));
vi.mock("@/lib/core-client/core", () => ({
  coreClient: () => ({ abandonCheckoutAttempt }),
}));
vi.mock("@/lib/core-client/commands", () => ({
  requireIdempotencyKey: (...args: unknown[]) => requireIdempotencyKey(...args),
}));

import { POST } from "@/app/api/checkout/quote/[quote-id]/abandon/route";

beforeEach(() => {
  abandonCheckoutAttempt.mockReset();
  requireIdempotencyKey.mockReset();
});

describe("checkout quote abandonment route", () => {
  it("forwards only the expected quote version and stable command key", async () => {
    requireIdempotencyKey.mockReturnValue("abandon-key");
    abandonCheckoutAttempt.mockResolvedValue({ ok: true, value: { outcome: "ABANDONED" } });
    const response = await POST(
      new Request("https://freshmarkets.ph/abandon", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "abandon-key" },
        body: JSON.stringify({ expectedVersion: 3 }),
      }),
      { params: Promise.resolve({ "quote-id": "quote-1" }) },
    );
    expect(response.status).toBe(200);
    expect(abandonCheckoutAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteId: "quote-1",
        expectedVersion: 3,
        idempotencyKey: "abandon-key",
      }),
    );
  });

  it("rejects an absent expected version before Core", async () => {
    requireIdempotencyKey.mockReturnValue("abandon-key");
    const response = await POST(
      new Request("https://freshmarkets.ph/abandon", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ "quote-id": "quote-1" }) },
    );
    expect(response.status).toBe(400);
    expect(abandonCheckoutAttempt).not.toHaveBeenCalled();
  });
});
