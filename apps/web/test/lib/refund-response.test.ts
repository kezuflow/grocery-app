import { expect, it } from "vitest";
import { refundAmountMinor, refundResponse } from "../../lib/refund-response";

it("accepts exact minor units without rounding or exponential notation", () => {
  expect(refundAmountMinor("25.01")).toBe(2501);
  expect(refundAmountMinor(" 0.1 ")).toBe(10);
  for (const invalid of ["", "0", "-1", "1.001", "1e2", "1,000", "9007199254740992"])
    expect(refundAmountMinor(invalid)).toBeNull();
});

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
