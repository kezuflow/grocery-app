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

export const addressSearchRequestSchema = z.object({
  requestId: identifierSchema,
  query: z.string().trim().min(1).max(200),
  proximity: z.object({ latitude: coordinateSchema, longitude: coordinateSchema }).optional(),
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

const addressBaseSchema = headersRequest.extend({
  label: reasonSchema,
  recipient: reasonSchema,
  phone: reasonSchema,
  latitude: coordinateSchema,
  longitude: coordinateSchema,
  notes: z.string().max(1000).nullable().optional(),
});

const nullableAddressText = z.string().trim().max(500).nullable();
const addressComponentsSchema = z.object({
  addressLine1: z.string().trim().min(1).max(500),
  addressLine2: nullableAddressText,
  barangay: nullableAddressText,
  city: z.string().trim().min(1).max(200),
  region: nullableAddressText,
  postalCode: z.string().trim().max(32).nullable(),
  countryCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/),
});
const confirmationSourceSchema = z.enum(["GEOCODER", "USER_PIN", "DEVICE_LOCATION"]);
const componentsSourceSchema = z.enum(["TEMPORARY_GEOCODER", "FIRST_PARTY", "SAVED_ADDRESS"]);
const deliveryInstructionsSchema = z.object({
  buildingUnit: nullableAddressText,
  landmark: nullableAddressText,
  gateGuard: nullableAddressText,
  deliveryNote: z.string().trim().max(1000).nullable(),
  recipientInstruction: z.string().trim().max(1000).nullable(),
});

export const addressRequestSchema = z.union([
  addressBaseSchema.extend({
    components: addressComponentsSchema,
    componentsSource: componentsSourceSchema.exclude(["SAVED_ADDRESS"]),
    confirmationSource: confirmationSourceSchema,
    instructions: deliveryInstructionsSchema,
    addressJson: z.string().min(2).optional(),
  }),
  addressBaseSchema.extend({
    addressJson: z.string().min(2),
    components: z.never().optional(),
    componentsSource: z.never().optional(),
    confirmationSource: z.never().optional(),
    instructions: z.never().optional(),
  }),
]);

export const addressUpdateRequestSchema = headersRequest
  .extend({
    addressId: identifierSchema,
    expectedVersion: z.number().int().safe().nonnegative(),
    label: reasonSchema.optional(),
    recipient: reasonSchema.optional(),
    phone: reasonSchema.optional(),
    components: addressComponentsSchema.optional(),
    componentsSource: componentsSourceSchema.optional(),
    confirmationSource: confirmationSourceSchema.optional(),
    instructions: deliveryInstructionsSchema.optional(),
    addressJson: z.string().min(2).optional(),
    latitude: coordinateSchema.optional(),
    longitude: coordinateSchema.optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .superRefine((input, context) => {
    const hasLatitude = input.latitude !== undefined;
    const hasLongitude = input.longitude !== undefined;
    const hasCoordinatePair = hasLatitude && hasLongitude;
    if (input.components !== undefined && input.componentsSource === undefined)
      context.addIssue({
        code: "custom",
        message: "componentsSource is required with structured components",
        path: ["componentsSource"],
      });
    if (input.components === undefined && input.componentsSource !== undefined)
      context.addIssue({
        code: "custom",
        message: "components are required with componentsSource",
        path: ["components"],
      });
    if (
      input.componentsSource === "TEMPORARY_GEOCODER" &&
      (!hasCoordinatePair || input.confirmationSource === undefined)
    )
      context.addIssue({
        code: "custom",
        message: "temporary geocoder components require a final confirmed coordinate",
        path: ["componentsSource"],
      });
    if (hasLatitude !== hasLongitude)
      context.addIssue({
        code: "custom",
        message: "latitude and longitude must be provided together",
        path: hasLatitude ? ["longitude"] : ["latitude"],
      });
    if (input.confirmationSource !== undefined && !hasCoordinatePair)
      context.addIssue({
        code: "custom",
        message: "confirmationSource requires latitude and longitude",
        path: ["confirmationSource"],
      });
    const explicitLegacyCoordinateEdit =
      hasCoordinatePair &&
      input.addressJson !== undefined &&
      input.components === undefined &&
      input.instructions === undefined;
    if (
      hasCoordinatePair &&
      input.confirmationSource === undefined &&
      !explicitLegacyCoordinateEdit
    )
      context.addIssue({
        code: "custom",
        message: "structured coordinate edits require confirmationSource",
        path: ["confirmationSource"],
      });
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
  cartId: identifierSchema,
  skuId: identifierSchema,
  quantity: z.number().int().safe().nonnegative(),
  expectedVersion: expectedVersionSchema,
  idempotencyKey: idempotencyKeySchema,
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
  action: z.enum([
    "START_PICKING",
    "MARK_READY_TO_PACK",
    "START_PACKING",
    "MARK_PACKED",
    "HAND_OFF",
    "COMPLETE",
    "RECORD_SHORTAGE",
    "RESUME_PICKING",
    "RESUME_READY_TO_PACK",
    "CANCEL",
    "ESCALATE",
  ]),
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: expectedVersionSchema,
});

export const deliveryCommandSchema = headersRequest.extend({
  orderId: identifierSchema,
  action: z.enum([
    "MARK_EN_ROUTE",
    "MARK_ARRIVED",
    "MARK_DELIVERED",
    "MARK_FAILED",
    "SCHEDULE_RETRY",
    "ESCALATE",
    "CANCEL",
  ]),
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
  // Null selects the INSTANT path at an instant-enabled location.
  deliveryCycleId: identifierSchema.nullable(),
  promotionCodes: z.array(z.string().trim().min(1).max(64)).max(5).optional(),
  idempotencyKey: idempotencyKeySchema,
});

export const refreshCheckoutQuoteSchema = headersRequest.extend({
  quoteId: identifierSchema,
  expectedVersion: expectedVersionSchema,
});

export const abandonCheckoutAttemptSchema = headersRequest.extend({
  quoteId: identifierSchema,
  expectedVersion: positiveIntegerSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const createPaymentIntentSchema = headersRequest.extend({
  checkoutAttemptId: identifierSchema,
  expectedQuoteVersion: positiveIntegerSchema,
  expectedPriceAcceptanceVersion: positiveIntegerSchema,
  expectedCurrency: z.string().trim().min(3).max(3),
  expectedMerchandiseSubtotalMinor: z.number().int().nonnegative(),
  expectedItemDiscountMinor: z.number().int().nonnegative(),
  expectedOrderDiscountMinor: z.number().int().nonnegative(),
  expectedDeliverySubtotalMinor: z.number().int().nonnegative(),
  expectedDeliveryFeeMinor: z.number().int().nonnegative(),
  expectedDeliveryDiscountMinor: z.number().int().nonnegative(),
  expectedServiceFeeMinor: z.number().int().nonnegative(),
  expectedTaxMinor: z.number().int().nonnegative(),
  expectedTotalMinor: z.number().int().nonnegative(),
  returnUrl: z.string().url().max(2000),
  idempotencyKey: idempotencyKeySchema,
});
