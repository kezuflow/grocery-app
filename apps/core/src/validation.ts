import {
  authenticatedRequestSchema,
  coordinateSchema,
  expectedVersionSchema,
  idempotencyKeySchema,
  identifierSchema,
  nonZeroIntegerSchema,
  positiveIntegerSchema,
  reasonSchema,
  z,
} from "@freshmarkets/validation";

export { authenticatedRequestSchema };

const headersRequest = authenticatedRequestSchema;

export const serviceabilityRequestSchema = z.object({
  requestId: identifierSchema,
  latitude: coordinateSchema,
  longitude: coordinateSchema,
  marketCode: identifierSchema.optional(),
});

const catalogSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected kebab-case slug");

export const catalogSearchRequestSchema = z.object({
  requestId: identifierSchema,
  query: z.string().trim().max(200).optional(),
  categorySlug: catalogSlugSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.number().int().safe().min(1).max(50).optional(),
  locationId: identifierSchema.optional(),
});

export const marketplaceHomeRequestSchema = z.object({
  requestId: identifierSchema,
  locationId: identifierSchema.optional(),
  itemsPerRail: z.number().int().safe().min(1).max(12).optional(),
});

export const catalogProductRequestSchema = z.object({
  requestId: identifierSchema,
  slug: identifierSchema,
  locationId: identifierSchema.optional(),
});

export const addressRequestSchema = headersRequest.extend({
  label: reasonSchema,
  recipient: reasonSchema,
  phone: reasonSchema,
  addressJson: z.string().min(2),
  latitude: coordinateSchema,
  longitude: coordinateSchema,
  notes: z.string().max(1000).nullable().optional(),
});

export const addressUpdateRequestSchema = headersRequest.extend({
  addressId: identifierSchema,
  expectedVersion: z.number().int().safe().nonnegative(),
  label: reasonSchema.optional(),
  recipient: reasonSchema.optional(),
  phone: reasonSchema.optional(),
  addressJson: z.string().min(2).optional(),
  latitude: coordinateSchema.optional(),
  longitude: coordinateSchema.optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const checkoutRequestSchema = headersRequest.extend({
  addressId: identifierSchema,
  cycleId: identifierSchema,
  cartId: identifierSchema,
});

export const commitOrderRequestSchema = checkoutRequestSchema.extend({
  idempotencyKey: idempotencyKeySchema,
});

export const setCartItemRequestSchema = headersRequest.extend({
  skuId: identifierSchema,
  quantity: z.number().int().safe().nonnegative(),
  locationId: identifierSchema.optional(),
});

export const adminOrderCommandSchema = headersRequest.extend({
  orderId: identifierSchema,
  action: z.enum(["CANCEL", "REFUND"]),
  reason: reasonSchema,
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: expectedVersionSchema,
});

export const inventoryAdjustmentSchema = headersRequest.extend({
  locationId: identifierSchema,
  inventoryPoolId: identifierSchema,
  delta: nonZeroIntegerSchema,
  reason: reasonSchema,
  idempotencyKey: idempotencyKeySchema,
  // Concurrent balance mutation requires an explicit expected version.
  expectedVersion: expectedVersionSchema,
});

export const procurementCommandSchema = headersRequest.extend({
  deliveryCycleId: identifierSchema,
  locationId: identifierSchema,
  inventoryPoolId: identifierSchema,
  quantity: positiveIntegerSchema,
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: expectedVersionSchema,
});

export const receivingCommandSchema = headersRequest.extend({
  requirementId: identifierSchema,
  acceptedQuantity: z.number().int().safe().nonnegative(),
  rejectedQuantity: z.number().int().safe().nonnegative(),
  reason: z.string().max(1000).optional(),
  idempotencyKey: idempotencyKeySchema,
  // Concurrent receipt mutation requires an explicit expected version.
  expectedVersion: expectedVersionSchema,
});

export const fulfillmentCommandSchema = headersRequest.extend({
  orderId: identifierSchema,
  action: z.enum(["START", "PACK", "SHORTAGE"]),
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: expectedVersionSchema,
});

export const deliveryCommandSchema = headersRequest.extend({
  orderId: identifierSchema,
  action: z.enum(["DISPATCH", "DELIVER", "FAIL"]),
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: expectedVersionSchema,
});

export function validationMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join(", ");
}

export const createCheckoutQuoteSchema = headersRequest.extend({
  cartId: identifierSchema,
  cartVersion: positiveIntegerSchema,
  addressId: identifierSchema,
  // Absent selects the INSTANT path at an instant-enabled location.
  deliveryCycleId: identifierSchema.optional(),
  idempotencyKey: idempotencyKeySchema,
});

export const refreshCheckoutQuoteSchema = headersRequest.extend({
  quoteId: identifierSchema,
  expectedVersion: expectedVersionSchema,
});

export const createPaymentIntentSchema = headersRequest.extend({
  checkoutAttemptId: identifierSchema,
  expectedTotalMinor: z.number().int().nonnegative(),
  returnUrl: z.string().url().max(2000),
  idempotencyKey: idempotencyKeySchema,
});
