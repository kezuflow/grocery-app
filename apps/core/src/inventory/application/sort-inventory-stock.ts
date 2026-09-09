import type { RpcResult } from "@freshmarkets/contracts";
import { sortInventoryStockSchema, inventorySortResultSchema } from "@freshmarkets/validation";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { stockSortingStatements } from "../infrastructure/stock-sorting-repository";

export async function sortInventoryStock(
  db: D1Database,
  actorUserId: string,
  requestId: string,
  now: number,
  input: unknown,
): Promise<RpcResult<{ sortId: string }>> {
  const fail = (
    code: "VALIDATION_FAILED" | "FORBIDDEN" | "IDEMPOTENCY_CONFLICT" | "CONFLICT",
    message: string,
  ) => ({ ok: false as const, error: { code, message, requestId } });
  const parsed = sortInventoryStockSchema.safeParse(input);
  if (!parsed.success)
    return fail(
      "VALIDATION_FAILED",
      "Enter the measured grams, actual size counts, reason and current stock version",
    );
  const request = parsed.data;
  const authority = `SELECT 1 FROM staff_identity s JOIN staff_role sr ON sr.staff_id=s.id
    JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id AND p.code='inventory.adjust'
    JOIN staff_scope sc ON sc.staff_id=s.id JOIN fulfillment_location l ON l.id=?
    WHERE s.auth_user_id=? AND s.status='active' AND (sc.scope_kind='global' OR
      (sc.scope_kind='location' AND sc.location_id=l.id) OR (sc.scope_kind='market' AND sc.market_id=l.market_id))`;
  if (!(await db.prepare(authority).bind(request.locationId, actorUserId).first()))
    return fail("FORBIDDEN", "Stock management is required at this location");
  const { idempotencyKey, ...payload } = request;
  const hash = await requestHash({ ...payload, actorUserId });
  const scope = "inventory.sort";
  async function replay(): Promise<RpcResult<{ sortId: string }> | null> {
    const saved = await findIdempotencyRecord(db, scope, idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return fail("IDEMPOTENCY_CONFLICT", "This key belongs to different stock counts");
    if (saved.status !== "SUCCEEDED" || !saved.resultReference) return null;
    return {
      ok: true,
      value: inventorySortResultSchema.parse(JSON.parse(saved.resultReference)),
      requestId,
    };
  }
  const previous = await replay();
  if (previous) return previous;
  const sorting = await stockSortingStatements(db, {
    ...request,
    actorUserId,
    now,
    effectKey: `sort:${idempotencyKey}`,
  });
  if (!sorting)
    return fail("VALIDATION_FAILED", "Choose actual sizes belonging to this counted product");
  const result = { sortId: sorting.sortId };
  const required = () =>
    db.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()<>1");
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (${authority})`)
        .bind(request.locationId, actorUserId),
      db
        .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at)
        VALUES (?,?,?,'PROCESSING','inventory_sort',?,?)`)
        .bind(scope, idempotencyKey, hash, now, now),
      required(),
      ...sorting.statements,
      auditEventStatement(db, {
        actorUserId,
        action: "INVENTORY.SORTED",
        resourceType: "inventory_sort",
        resourceId: sorting.sortId,
        locationId: request.locationId,
        reason: request.reason,
        details: payload,
        idempotencyKey,
        correlationId: requestId,
        occurredAt: now,
      }),
      required(),
      db
        .prepare(`UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=?
        WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'`)
        .bind(JSON.stringify(result), now, scope, idempotencyKey, hash),
      required(),
    ]);
    return { ok: true, value: result, requestId };
  } catch {
    const committed = await replay();
    return (
      committed ??
      fail("CONFLICT", "Stock or size availability changed; refresh before counting again")
    );
  }
}
