import type { AdminStaffDetail, RpcResult } from "@freshmarkets/contracts";
import { findIdempotencyRecord } from "../../idempotency";
import { staffCommandReceiptSchema } from "../../iam/infrastructure/staff-command-receipt";
import { readStaffDetail, type StaffAdministrationDeps } from "./staff-administration-access";

/** Call only after authenticating and authorizing the staff administration request. */
export async function replayStaffCommand(
  deps: StaffAdministrationDeps,
  input: {
    scope: string;
    key: string;
    hash: string;
    staffId: string;
    requestId: string;
  },
): Promise<RpcResult<AdminStaffDetail> | null> {
  const saved = await findIdempotencyRecord(deps.db, input.scope, input.key);
  if (!saved) return null;
  if (saved.requestHash !== input.hash)
    return {
      ok: false,
      error: {
        code: "IDEMPOTENCY_CONFLICT",
        message: "Idempotency key was used with a different request",
        requestId: input.requestId,
      },
    };
  if (saved.status !== "SUCCEEDED") return null;
  if (saved.resultType === input.scope && saved.resultReference === input.staffId)
    return readStaffDetail(deps, input.staffId, input.requestId);
  if (saved.resultType === "staff_change_snapshot" && saved.resultReference) {
    try {
      const value: unknown = JSON.parse(saved.resultReference);
      const parsed = staffCommandReceiptSchema.safeParse(value);
      if (parsed.success && parsed.data.staffId === input.staffId) {
        let roleIds = parsed.data.roleIds;
        if (!roleIds) {
          // Retained role codes are immutable, unique identities; do not use current staff grants.
          const roles = await deps.db
            .prepare(
              "SELECT id FROM role WHERE code IN (SELECT value FROM json_each(?)) ORDER BY id",
            )
            .bind(JSON.stringify(parsed.data.roleCodes))
            .all<{ id: string }>();
          if (roles.results.length !== parsed.data.roleCodes.length)
            throw new Error("Retained role identity unavailable");
          roleIds = roles.results.map((role) => role.id);
        }
        return { ok: true, value: { ...parsed.data, roleIds }, requestId: input.requestId };
      }
    } catch {
      /* Invalid retained evidence cannot authorize another mutation. */
    }
  }
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Saved staff result is unavailable",
      requestId: input.requestId,
    },
  };
}
