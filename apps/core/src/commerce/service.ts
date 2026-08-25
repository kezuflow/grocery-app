import type { ServiceabilityRequest } from "@freshmarkets/contracts";
import { resolveServiceability } from "../geography/serviceability";

type Database = ReturnType<typeof import("drizzle-orm/d1").drizzle>;

export type CheckoutInput = ServiceabilityRequest & {
  customerId: string;
  hasEligibleSubscription: boolean;
};

export function checkoutEligibility(input: CheckoutInput, serviceable: boolean) {
  const failures: string[] = [];
  if (!input.customerId) failures.push("UNAUTHENTICATED");
  if (!input.hasEligibleSubscription) failures.push("SUBSCRIPTION_REQUIRED");
  if (!serviceable) failures.push("ADDRESS_NOT_SERVICEABLE");
  return { eligible: failures.length === 0, failures };
}

export async function resolveCheckoutGeography(database: Database, input: ServiceabilityRequest) {
  return resolveServiceability(database, input);
}
