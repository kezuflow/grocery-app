import type {
  AuthenticatedRequest,
  CapabilityDefinitionView,
  RpcResult,
} from "@freshmarkets/contracts";
import { isAdminCapability, type Capability } from "@freshmarkets/contracts";
import {
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

/** The closed canonical capability vocabulary from the permission registry. */
export async function listCapabilityDefinitions(
  deps: StaffAdministrationDeps,
  request: AuthenticatedRequest,
): Promise<RpcResult<ReadonlyArray<CapabilityDefinitionView>>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.read");
  if (!access.ok) return access;

  const rows = await deps.db
    .prepare("SELECT code, description FROM permission ORDER BY code")
    .all<{ code: string; description: string }>();
  const value: CapabilityDefinitionView[] = rows.results
    .filter((row) => isAdminCapability(row.code))
    .map((row) => ({ code: row.code as Capability, description: row.description }));
  return { ok: true, value, requestId: request.requestId };
}
