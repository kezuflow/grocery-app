import type { CheckoutQuoteRow } from "../infrastructure/d1-checkout-repository";
import { scheduledWindowSnapshotSchema } from "../../commerce/application/scheduled-window";
import type { CreateCheckoutQuoteCommand } from "./create-checkout-quote";

function normalizedPromotionCodes(command: CreateCheckoutQuoteCommand): string[] {
  return (command.promotionCodes ?? []).map((code) => code.trim().toUpperCase());
}

/**
 * Idempotency is safe only when the stored quote belongs to the same authority
 * and represents the same normalized command. Both the ordinary replay and the
 * uniqueness-race recovery path must use this exact predicate.
 */
export function checkoutQuoteMatchesCommand(
  existing: CheckoutQuoteRow,
  command: CreateCheckoutQuoteCommand,
): boolean {
  const savedWindow = scheduledWindowSnapshotSchema.safeParse(
    existing.cycleSnapshot &&
      typeof existing.cycleSnapshot === "object" &&
      "deliveryWindow" in existing.cycleSnapshot
      ? existing.cycleSnapshot.deliveryWindow
      : null,
  );
  const existingOptionId =
    existing.fulfillmentSnapshot && typeof existing.fulfillmentSnapshot === "object"
      ? (existing.fulfillmentSnapshot as { fulfillmentOptionId?: unknown }).fulfillmentOptionId
      : undefined;

  return !(
    existing.customerId !== command.customerId ||
    existing.cartId !== command.cartId ||
    existing.cartVersion !== command.cartVersion ||
    existing.addressId !== command.addressId ||
    (existing.deliveryCycleId ?? null) !== (command.deliveryCycleId ?? null) ||
    (command.deliveryWindowId !== undefined &&
      (!savedWindow.success || savedWindow.data.windowId !== command.deliveryWindowId)) ||
    (command.fulfillmentOptionId !== undefined &&
      existingOptionId !== command.fulfillmentOptionId) ||
    JSON.stringify(existing.requestedPromotionCodes) !==
      JSON.stringify(normalizedPromotionCodes(command))
  );
}

export function isCheckoutQuoteIdempotencyViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed:\s*checkout_quote\.idempotency_key/iu.test(message);
}
