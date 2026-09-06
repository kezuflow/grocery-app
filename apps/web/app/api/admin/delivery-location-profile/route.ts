import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { requestHeaders } from "@/lib/core-client/request";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { invalid, requiredLocation } from "../operations-route-utils";

const bodySchema = z.object({
  locationId: z.string().trim().min(1),
  senderName: z.string().trim().min(1).max(120),
  phoneE164: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/),
  email: z.string().trim().email().max(254).nullable().optional(),
  formattedAddress: z.string().trim().min(1).max(500),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  barangay: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().min(1).max(120),
  region: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  countryCode: z.string().trim().length(2),
  pickupInstructions: z.string().trim().max(1000).nullable().optional(),
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().trim().min(1).optional(),
});

async function GETHandler(request: Request) {
  const locationId = requiredLocation(request, new URL(request.url).searchParams);
  if (locationId instanceof Response) return locationId;
  return adminJson(
    await coreClient(env.CORE).getLocationDeliveryProfile({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      locationId,
    }),
  );
}

async function PUTHandler(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return invalid(request, "A complete, valid store pickup profile is required");
  try {
    return adminJson(
      await coreClient(env.CORE).upsertLocationDeliveryProfile({
        requestId: webRequestId(request),
        headers: requestHeaders(request),
        ...parsed.data,
        idempotencyKey: requireIdempotencyKey(request, parsed.data.idempotencyKey),
      }),
    );
  } catch (error) {
    return invalid(request, (error as Error).message);
  }
}

export const GET = observeAdminRoute("admin.delivery_location_profile.get", GETHandler);
export const PUT = observeAdminRoute("admin.delivery_location_profile.put", PUTHandler);
