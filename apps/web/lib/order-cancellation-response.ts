import { appErrorCodes } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";

const cancellation = z.object({
  cancellationId: z.string(),
  status: z.enum(["REQUESTED", "REFUNDS_PROCESSING", "COMPLETED", "EXCEPTION"]),
  requiredRefundMinor: z.number().int().safe().nonnegative(),
  retainedServiceFeeMinor: z.number().int().safe().nonnegative(),
  currency: z.string(),
  refunds: z.array(
    z.object({
      paymentId: z.string(),
      refundId: z.string().nullable(),
      amountMinor: z.number().int().safe().nonnegative(),
      status: z.enum([
        "NOT_REQUESTED",
        "REQUESTED",
        "APPROVED",
        "PROCESSING",
        "SUCCEEDED",
        "REJECTED",
        "FAILED",
        "ESCALATED",
      ]),
    }),
  ),
});
const failure = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.enum(appErrorCodes), message: z.string(), requestId: z.string() }),
});
export const customerCancellationResponse = z.union([
  failure,
  z.object({ ok: z.literal(true), requestId: z.string(), value: cancellation }),
]);
export const adminCancellationResponse = z.union([
  failure,
  z.object({
    ok: z.literal(true),
    requestId: z.string(),
    value: z.object({
      orderId: z.string(),
      state: z.enum(["CANCELED", "CANCELLATION_REQUESTED"]),
      cancellation: cancellation.nullable(),
    }),
  }),
]);
