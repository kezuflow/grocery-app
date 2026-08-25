import type { CoreHealthResponse, CoreServiceBinding } from "@freshmarkets/contracts";

export async function getCoreHealth(
  core: CoreServiceBinding,
  requestId = crypto.randomUUID(),
): Promise<CoreHealthResponse> {
  return core.health({ requestId });
}
