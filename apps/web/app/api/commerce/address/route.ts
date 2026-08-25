import { env } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { requestHeaders } from "../../../../lib/core-client/request";
const addressBodySchema = z.object({
  label: z.string().trim().min(1),
  recipient: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  address: z.record(z.string(), z.string()).optional(),
  latitude: z.number().finite(),
  longitude: z.number().finite(),
  notes: z.string().max(1000).optional(),
});
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
  const result = await (env.CORE as unknown as CoreServiceBinding).createCustomerAddress({
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
