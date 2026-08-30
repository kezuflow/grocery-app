import { deliveryJobStates, type DeliveryJobState } from "@freshmarkets/contracts";
import { identifierSchema, positiveIntegerSchema, z } from "@freshmarkets/validation";

const deliverySchema = z
  .object({
    jobId: identifierSchema,
    expectedVersion: positiveIntegerSchema,
  })
  .strict();

export const orderedDeliveriesSchema = z
  .array(deliverySchema)
  .min(1)
  .max(24)
  .refine(
    (deliveries) => new Set(deliveries.map(({ jobId }) => jobId)).size === deliveries.length,
    { message: "Delivery jobs must be unique" },
  );

const instantContextSchema = z
  .object({
    locationId: identifierSchema,
    fulfillmentMode: z.literal("INSTANT"),
    cycleId: z.null(),
  })
  .strict();

const scheduledContextSchema = z
  .object({
    locationId: identifierSchema,
    fulfillmentMode: z.literal("SCHEDULED"),
    cycleId: identifierSchema,
  })
  .strict();

export const dispatchContextSchema = z.union([instantContextSchema, scheduledContextSchema]);

export const deliveryJobStateSchema = z.enum(deliveryJobStates);

export type DispatchContext = z.infer<typeof dispatchContextSchema>;

export function validationFailure(requestId: string, message: string): Response {
  return Response.json(
    {
      ok: false as const,
      error: { code: "VALIDATION_FAILED" as const, message, requestId },
    },
    { status: 400 },
  );
}

export function hasOnlyQueryKeys(
  params: URLSearchParams,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Array.from(params.keys()).every((key) => allowedKeys.has(key));
}

function singleQueryValue(params: URLSearchParams, name: string): string | null | undefined {
  const values = params.getAll(name);
  if (values.length > 1) return undefined;
  return values[0] ?? null;
}

export function parseQueryContext(params: URLSearchParams): DispatchContext | null {
  const locationId = singleQueryValue(params, "locationId");
  const fulfillmentMode = singleQueryValue(params, "fulfillmentMode");
  const cycleId = singleQueryValue(params, "cycleId");
  if (locationId === undefined || fulfillmentMode === undefined || cycleId === undefined)
    return null;
  const parsed = dispatchContextSchema.safeParse({
    locationId,
    fulfillmentMode,
    cycleId,
  });
  return parsed.success ? parsed.data : null;
}

export function parseOptionalStatuses(
  params: URLSearchParams,
): ReadonlyArray<DeliveryJobState> | undefined | null {
  const values = params.getAll("statuses");
  if (values.length === 0) return undefined;
  const parsed = z.array(deliveryJobStateSchema).min(1).safeParse(values);
  return parsed.success ? parsed.data : null;
}

export function parseOptionalIdentifier(
  params: URLSearchParams,
  name: string,
): string | undefined | null {
  const values = params.getAll(name);
  if (values.length === 0) return undefined;
  if (values.length !== 1) return null;
  const parsed = identifierSchema.safeParse(values[0]);
  return parsed.success ? parsed.data : null;
}

export function parseRequiredIdentifier(params: URLSearchParams, name: string): string | null {
  const parsed = parseOptionalIdentifier(params, name);
  return parsed ?? null;
}

export function parsePositiveVersion(params: URLSearchParams, name: string): number | null {
  const values = params.getAll(name);
  if (values.length !== 1 || !/^[0-9]+$/.test(values[0])) return null;
  const parsed = positiveIntegerSchema.safeParse(Number(values[0]));
  return parsed.success ? parsed.data : null;
}
