import { env } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
export async function GET() {
  return Response.json(
    await (env.CORE as unknown as CoreServiceBinding).listDeliveryCycles({
      requestId: crypto.randomUUID(),
      marketCode: "METRO_CEBU",
    }),
  );
}
