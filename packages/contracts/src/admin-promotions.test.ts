import { expect, it } from "vitest";
import {
  promotionStatuses,
  manageableBenefitTypes,
  previewReasonCodes,
  reservedPromotionCodes,
} from "./admin-promotions";

it("publishes the closed lifecycle, benefit, and preview vocabularies", () => {
  expect(promotionStatuses).toEqual(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]);
  expect(manageableBenefitTypes).toEqual([
    "ORDER_FIXED_DISCOUNT",
    "ORDER_PERCENT_DISCOUNT",
    "DELIVERY_FEE_WAIVER",
    "DELIVERY_PERCENT_DISCOUNT",
    "DELIVERY_FIXED_DISCOUNT",
  ]);
  expect(reservedPromotionCodes).toEqual(["INTRO_TRIAL", "LEGACY_TRIAL_HISTORY"]);
  expect(previewReasonCodes).toEqual([
    "PROMOTION_INACTIVE",
    "PROMOTION_NOT_STARTED",
    "PROMOTION_EXPIRED",
    "MINIMUM_ORDER_NOT_MET",
    "CUSTOMER_INELIGIBLE",
    "CUSTOMER_UNAVAILABLE",
  ]);
});
