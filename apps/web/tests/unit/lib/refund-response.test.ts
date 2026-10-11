import { expect, it } from "vitest";
import { refundResponse } from "../../../lib/refund-response";

it("keeps malformed and non-acceptance responses unresolved", () => {
  expect(refundResponse.safeParse({ ok: true }).success).toBe(false);
  const receipt = {
    ok: true,
    requestId: "request",
    value: {
      refundId: "refund",
      paymentIntentId: "payment",
      amountMinor: 2501,
      currency: "PHP",
      status: "REQUESTED",
      reason: "Quality issue",
      createdAt: "2026-09-08T00:00:00Z",
    },
  };
  expect(refundResponse.parse(receipt)).toEqual(receipt);
  expect(
    refundResponse.safeParse({ ...receipt, value: { ...receipt.value, status: "SUCCEEDED" } })
      .success,
  ).toBe(false);
});
