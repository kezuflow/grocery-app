import { env } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { requestHeaders } from "../../../../lib/core-client/request";
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const body = (await request.json()) as Record<string, unknown>;
  const result = await (env.CORE as unknown as CoreServiceBinding).createCustomerAddress({
    requestId,
    headers: requestHeaders(request),
    label: String(body.label ?? "Home"),
    recipient: String(body.recipient ?? ""),
    phone: String(body.phone ?? ""),
    addressJson: JSON.stringify(body.address ?? {}),
    latitude: Number(body.latitude),
    longitude: Number(body.longitude),
    notes: body.notes ? String(body.notes) : undefined,
  });
  return Response.json(result);
}
