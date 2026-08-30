import { describe, expect, it } from "vitest";
import { invoiceReadiness } from "./invoice-readiness";
const financial = {
  currency: "PHP",
  merchandiseSubtotalMinor: 10000,
  itemDiscountMinor: 0,
  orderDiscountMinor: 1000,
  deliverySubtotalMinor: 500,
  deliveryDiscountMinor: 500,
  serviceFeeMinor: 0,
  taxMinor: 0,
  totalMinor: 9000,
};
describe("invoice readiness", () => {
  it("stays pending without approved seller and tax facts", () => {
    expect(
      invoiceReadiness({
        financial,
        sellerSnapshot: null,
        buyerSnapshot: {},
        taxPolicyVersion: null,
        taxClassifications: null,
      }),
    ).toMatchObject({ ok: true, status: "PENDING_TAX_CONFIGURATION" });
  });
  it("permits readiness only from complete supplied facts and never calculates tax", () => {
    expect(
      invoiceReadiness({
        financial,
        sellerSnapshot: { name: "Seller" },
        buyerSnapshot: {},
        taxPolicyVersion: "approved-v1",
        taxClassifications: { merchandise: "SUPPLIED" },
      }),
    ).toMatchObject({ ok: true, status: "READY_FOR_ISSUANCE" });
    expect(
      invoiceReadiness({
        financial: { ...financial, totalMinor: 1 },
        sellerSnapshot: null,
        buyerSnapshot: {},
        taxPolicyVersion: null,
        taxClassifications: null,
      }),
    ).toMatchObject({ ok: false, code: "INCONSISTENT_FINANCIAL_FACTS" });
  });
});
