import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { requestHeaders } from "../../../../lib/core-client/request";
import { coreClient } from "@/lib/core-client/core";

const nullableAddressText = z.string().trim().max(500).nullable();
const componentsSchema = z.object({
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
const instructionsSchema = z.object({
  buildingUnit: nullableAddressText,
  landmark: nullableAddressText,
  gateGuard: nullableAddressText,
  deliveryNote: z.string().trim().max(1000).nullable(),
  recipientInstruction: z.string().trim().max(1000).nullable(),
});
const confirmationSourceSchema = z.enum(["GEOCODER", "USER_PIN", "DEVICE_LOCATION"]);
const addressBodySchema = z.object({
  label: z.string().trim().min(1),
  recipient: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  components: componentsSchema,
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  confirmationSource: confirmationSourceSchema,
  instructions: instructionsSchema,
  notes: z.string().max(1000).nullable().optional(),
});
const updateAddressBodySchema = addressBodySchema
  .partial()
  .extend({
    addressId: z.string().trim().min(1),
    expectedVersion: z.number().int().nonnegative(),
  })
  .superRefine((value, context) => {
    const hasLatitude = value.latitude !== undefined;
    const hasLongitude = value.longitude !== undefined;
    if (hasLatitude !== hasLongitude)
      context.addIssue({
        code: "custom",
        message: "latitude and longitude must be provided together",
        path: [hasLatitude ? "longitude" : "latitude"],
      });
    if (hasLatitude && value.confirmationSource === undefined)
      context.addIssue({
        code: "custom",
        message: "confirmationSource is required for coordinate edits",
        path: ["confirmationSource"],
      });
  });

function resultStatus(result: { ok: boolean; error?: { code: string } }): number {
  if (result.ok) return 200;
  if (result.error?.code === "UNAUTHENTICATED") return 401;
  if (result.error?.code === "FORBIDDEN") return 403;
  if (result.error?.code === "NOT_FOUND") return 404;
  if (result.error?.code === "STALE_VERSION" || result.error?.code === "CONFLICT") return 409;
  if (result.error?.code.startsWith("GEOCODER_")) return 503;
  return 400;
}
export async function GET(request: Request) {
  const result = await coreClient(env.CORE).listCustomerAddresses({
    requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
    headers: requestHeaders(request),
  });
  return Response.json(result, { status: resultStatus(result) });
}
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const parsed = addressBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "Invalid address request", requestId },
      },
      { status: 400 },
    );
  const body = parsed.data;
  const result = await coreClient(env.CORE).createCustomerAddress({
    requestId,
    headers: requestHeaders(request),
    label: body.label,
    recipient: body.recipient,
    phone: body.phone,
    components: body.components,
    latitude: body.latitude,
    longitude: body.longitude,
    confirmationSource: body.confirmationSource,
    instructions: body.instructions,
    notes: body.notes,
  });
  return Response.json(result, { status: resultStatus(result) });
}
export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  const parsed = updateAddressBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "Invalid address update", requestId },
      },
      { status: 400 },
    );
  const body = parsed.data;
  const result = await coreClient(env.CORE).updateCustomerAddress({
    requestId,
    headers: requestHeaders(request),
    addressId: body.addressId,
    expectedVersion: body.expectedVersion,
    label: body.label,
    recipient: body.recipient,
    phone: body.phone,
    components: body.components,
    confirmationSource: body.confirmationSource,
    instructions: body.instructions,
    latitude: body.latitude,
    longitude: body.longitude,
    notes: body.notes,
  });
  return Response.json(result, { status: resultStatus(result) });
}
