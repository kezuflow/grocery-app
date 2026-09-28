import { expect, it } from "vitest";
import {
  customerClosureRequestTypes,
  privacyRequestStatuses,
  privacyRequestActions,
} from "./admin-customers";

it("publishes the closed closure, privacy status, and action vocabularies", () => {
  expect(customerClosureRequestTypes).toEqual(["ACCESS", "CORRECTION", "CLOSURE", "ANONYMIZATION"]);
  expect(privacyRequestStatuses).toEqual([
    "SUBMITTED",
    "VERIFYING",
    "APPROVED",
    "REJECTED",
    "PROCESSING",
    "COMPLETED",
    "ESCALATED",
  ]);
  expect(privacyRequestActions).toEqual([
    "VERIFY",
    "APPROVE",
    "REJECT",
    "BEGIN_PROCESSING",
    "COMPLETE",
    "ESCALATE",
  ]);
});
