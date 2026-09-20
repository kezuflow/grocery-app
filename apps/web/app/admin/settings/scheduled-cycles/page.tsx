import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import type { AdminDeliveryCyclePage, RpcResult } from "@freshmarkets/contracts";
import { coreClient } from "@/lib/core-client/core";
import { coreRequestHeaders } from "@/lib/core-client/request";
import { DeliveryCyclesWorkspace } from "@/components/admin/delivery-cycles-workspace";

function plainResult(result: RpcResult<AdminDeliveryCyclePage>) {
  return JSON.parse(JSON.stringify(result)) as RpcResult<AdminDeliveryCyclePage>;
}

export default async function ScheduledCyclesPage() {
  const now = new Date();
  const rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const rangeEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
  const initial = plainResult(
    await coreClient(env.CORE).listAdminDeliveryCycles({
      headers: coreRequestHeaders(await headers()),
      requestId: crypto.randomUUID(),
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
    }),
  );
  return <DeliveryCyclesWorkspace initial={initial} />;
}
