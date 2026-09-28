import { expect, it } from "vitest";
import { appErrorCodes } from "./common";

it("publishes stable financial-safety error codes", () => {
  expect(appErrorCodes).toEqual(
    expect.arrayContaining([
      "TRIAL_ENDED",
      "SUBSCRIPTION_GRACE_ENDED",
      "MINIMUM_ORDER_NOT_MET",
      "PAYMENT_OUTCOME_UNRESOLVED",
      "AUTHORIZATION_OUTCOME_UNRESOLVED",
      "PAYMENT_ACTION_EXPIRED",
      "REFUND_AMOUNT_UNAVAILABLE",
    ]),
  );
});
