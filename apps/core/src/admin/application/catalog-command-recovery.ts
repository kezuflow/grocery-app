import type { AppErrorCode, RpcResult } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { findIdempotencyRecord } from "../../idempotency";
import type { CatalogAdministrationAccess } from "./catalog-administration-access";
export const catalogCommandFailure = (code: AppErrorCode, message: string, requestId: string) => ({
  ok: false as const,
  error: { code, message, requestId },
});
export const requireCatalogEffect = (db: D1Database) =>
  db.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()!=1");
export type CatalogCommandIdentity = {
  scope: string;
  key: string;
  hash: string;
  requestId: string;
};
export async function catalogCommandReceipt<T>(
  db: D1Database,
  command: CatalogCommandIdentity,
  schema: z.ZodType<T>,
): Promise<RpcResult<T> | null> {
  const record = await findIdempotencyRecord(db, command.scope, command.key);
  if (!record) return null;
  if (record.requestHash !== command.hash)
    return catalogCommandFailure(
      "IDEMPOTENCY_CONFLICT",
      "Key belongs to different catalog details",
      command.requestId,
    );
  if (record.status !== "SUCCEEDED") return null;
  if (!record.resultReference?.startsWith("{"))
    return catalogCommandFailure(
      "CONFLICT",
      "This historical catalog command already applied; review its history",
      command.requestId,
    );
  try {
    return {
      ok: true,
      requestId: command.requestId,
      value: schema.parse(JSON.parse(record.resultReference)),
    };
  } catch {
    return catalogCommandFailure(
      "CONFLICT",
      "Saved catalog evidence needs recovery review",
      command.requestId,
    );
  }
}
/** Caller supplies the complete owning write set and its transaction-time result projection. */
export async function executeCatalogCommand<T>(
  db: D1Database,
  command: CatalogCommandIdentity,
  actor: CatalogAdministrationAccess,
  action: string,
  effects: D1PreparedStatement[],
  receipt: D1PreparedStatement,
  schema: z.ZodType<T>,
  authority: { capability: "catalog.manage" | "prices.manage"; locationId?: string } = {
    capability: "catalog.manage",
  },
): Promise<RpcResult<T>> {
  const now = Date.now();
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (
        SELECT 1 FROM staff_identity s JOIN staff_scope sc ON sc.staff_id=s.id
        JOIN staff_role sr ON sr.staff_id=s.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id
        WHERE s.id=? AND s.auth_user_id=? AND s.status='active' AND p.code=?
        AND (sc.scope_kind='global' OR (? IS NOT NULL AND EXISTS (
          SELECT 1 FROM fulfillment_location l WHERE l.id=? AND ((sc.scope_kind='location' AND sc.location_id=l.id) OR (sc.scope_kind='market' AND sc.market_id=l.market_id))
        ))))`)
        .bind(
          actor.staffId,
          actor.authUserId,
          authority.capability,
          authority.locationId ?? null,
          authority.locationId ?? null,
        ),
      db
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (SELECT 1 FROM audit_event WHERE idempotency_key=? AND action=?)",
        )
        .bind(command.key, action),
      db
        .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,result_type,status,created_at,updated_at)
        VALUES (?,?,?,?,'PROCESSING',?,?) ON CONFLICT(scope,idempotency_key) DO UPDATE SET status='PROCESSING',updated_at=excluded.updated_at
        WHERE idempotency_records.request_hash=excluded.request_hash AND idempotency_records.status IN ('PROCESSING','FAILED') AND idempotency_records.result_reference IS NULL`)
        .bind(command.scope, command.key, command.hash, command.scope, now, now),
      requireCatalogEffect(db),
      ...effects,
      receipt,
      requireCatalogEffect(db),
    ]);
  } catch {
    return (
      (await catalogCommandReceipt(db, command, schema)) ??
      catalogCommandFailure(
        "CONFLICT",
        "Catalog state or access changed; refresh and review",
        command.requestId,
      )
    );
  }
  return (
    (await catalogCommandReceipt(db, command, schema)) ??
    catalogCommandFailure(
      "CONFLICT",
      "Catalog result could not be confirmed; retry the saved request",
      command.requestId,
    )
  );
}
