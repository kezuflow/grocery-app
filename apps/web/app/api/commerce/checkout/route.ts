import { env } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { requestHeaders } from "../../../../lib/core-client/request";
export async function POST(request: Request) {
  const body = (await request.json()) as {
    cartId: string;
    addressId: string;
    cycleId: string;
    commit?: boolean;
    idempotencyKey?: string;
  };
  const input = {
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    cartId: body.cartId,
    addressId: body.addressId,
    cycleId: body.cycleId,
  };
  const core = env.CORE as unknown as CoreServiceBinding;
  return Response.json(
    body.commit
      ? await core.commitMockOrder({
          ...input,
          idempotencyKey: body.idempotencyKey ?? crypto.randomUUID(),
        })
      : await core.evaluateCheckout(input),
  );
}
