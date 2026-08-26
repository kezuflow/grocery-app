import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { requestHeaders } from "../../../../lib/core-client/request";
import { coreClient } from "@/lib/core-client/core";
const addressBodySchema = z.object({
  label: z.string().trim().min(1),
  recipient: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  address: z.record(z.string(), z.string()).optional(),
  latitude: z.number().finite(),
  longitude: z.number().finite(),
  notes: z.string().max(1000).optional(),
});
const updateAddressBodySchema = addressBodySchema.partial().extend({
  addressId: z.string().trim().min(1),
  expectedVersion: z.number().int().nonnegative(),
});
export async function GET(request: Request) {
  return Response.json(
    await coreClient(env.CORE).listCustomerAddresses({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
    }),
  );
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
    addressJson: JSON.stringify(body.address ?? {}),
    latitude: body.latitude,
    longitude: body.longitude,
    notes: body.notes,
  });
  return Response.json(result);
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
  return Response.json(
    await coreClient(env.CORE).updateCustomerAddress({
      requestId,
      headers: requestHeaders(request),
      addressId: body.addressId,
      expectedVersion: body.expectedVersion,
      label: body.label,
      recipient: body.recipient,
      phone: body.phone,
      addressJson: body.address ? JSON.stringify(body.address) : undefined,
      latitude: body.latitude,
      longitude: body.longitude,
      notes: body.notes,
    }),
  );
}
