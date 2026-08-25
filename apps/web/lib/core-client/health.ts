import type { CoreHealthResponse, HealthService } from "@freshmarkets/contracts";

export async function getCoreHealth(
  core: HealthService,
  requestId = crypto.randomUUID(),
): Promise<CoreHealthResponse> {
  return core.health({ requestId });
}
