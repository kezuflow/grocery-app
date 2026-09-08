import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { coreRequestHeaders } from "@/lib/core-client/request";
import { DeliveryCyclesWorkspace } from "@/components/admin/delivery-cycles-workspace";

export default async function DeliveryCyclesPage() {
  const initial = await coreClient(env.CORE).listAdminDeliveryCycles({
    headers: coreRequestHeaders(await headers()),
    requestId: crypto.randomUUID(),
  });
  return <DeliveryCyclesWorkspace initial={initial} />;
}
