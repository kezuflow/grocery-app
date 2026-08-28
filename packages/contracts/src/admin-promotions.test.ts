import { describe, expect, it } from "vitest";
import {
  promotionStatuses,
  manageableBenefitTypes,
  previewReasonCodes,
  type AdminPromotionDetail,
  type AdminPromotionPreviewView,
} from "./admin-promotions";

describe("promotions contracts", () => {
  it("publishes the closed lifecycle, benefit, and preview vocabularies", () => {
    expect(promotionStatuses).toEqual(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]);
    expect(manageableBenefitTypes).toEqual(["ORDER_FIXED_DISCOUNT", "ORDER_PERCENT_DISCOUNT"]);
    expect(previewReasonCodes).toEqual([
      "PROMOTION_INACTIVE",
      "PROMOTION_NOT_STARTED",
      "PROMOTION_EXPIRED",
      "MINIMUM_ORDER_NOT_MET",
    ]);
  });

  it("keeps promotion and preview payloads as purpose-built DTOs", () => {
    void ({
      promotionId: "promo-1",
      code: "WELCOME50",
      name: "Welcome discount",
      description: "",
      status: "ACTIVE",
      benefitType: "ORDER_FIXED_DISCOUNT",
      discountMinor: 5000,
      percent: null,
      minimumMinor: 50000,
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: null,
      globalUsageLimit: null,
      perCustomerUsageLimit: null,
      automatic: false,
      priority: 0,
      version: 2,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    } satisfies AdminPromotionDetail);
    void ({
      eligible: true,
      reasonCode: null,
      discountMinor: 5000,
    } satisfies AdminPromotionPreviewView);
  });
});
