import { receivingActions } from "./receiving-actions";
import { receivingRecordStates, type AppErrorCode } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";

export type ReceivingAuthority = { authUserId: string; locationId: string };
type Common = {
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
  reason?: string;
  authority?: ReceivingAuthority;
};
export type ReceivingMutation =
  | (Common & { action: "START"; requirementId: string })
  | (Common & {
      action: "RECORD" | "REPLACE";
      receivingRecordId: string;
      acceptedDeltaBase: number;
      rejectedDeltaBase: number;
      shortageDeltaBase?: number;
    })
  | (Common & { action: "COMPLETE"; receivingRecordId: string });
const resultSchema = z.object({
  receivingRecordId: z.string(),
  requirementId: z.string(),
  cycleId: z.string(),
  locationId: z.string(),
  expectedBase: z.number().int().safe().nonnegative(),
  legacyAcceptedBase: z.number().int().safe().nonnegative(),
  status: z.enum(receivingRecordStates),
  acceptedBase: z.number().int().safe().nonnegative(),
  rejectedBase: z.number().int().safe().nonnegative(),
  shortageBase: z.number().int().safe().nonnegative().default(0),
  replacementBase: z.number().int().safe().nonnegative().default(0),
  remainingBase: z.number().int().safe().nonnegative(),
  version: z.number().int().safe().positive(),
  inventoryVersion: z.null(),
});
export type ReceivingResult = z.infer<typeof resultSchema>;
function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}
type Result = { ok: true; value: ReceivingResult; requestId: string } | ReturnType<typeof failure>;
type Receipt = {
  id: string;
  requirementId: string;
  cycleId: string;
  locationId: string;
  inventoryPoolId: string;
  expectedBase: number;
  acceptedBase: number;
  rejectedBase: number;
  shortageBase: number;
  replacementBase: number;
  legacyAcceptedBase: number;
  status: string;
  version: number;
  requirementStatus: string;
  requirementVersion: number;
};

/** Receiving owns accepted cycle goods; physical stock is only credited by inspected surplus release. */
export async function executeReceivingCommand(
  database: D1Database,
  command: ReceivingMutation,
): Promise<Result> {
  if (
    !Number.isSafeInteger(command.expectedVersion) ||
    command.expectedVersion < 1 ||
    !command.idempotencyKey.trim() ||
    command.idempotencyKey.length > 200
  )
    return failure(
      "VALIDATION_FAILED",
      "A receipt version and stable command key are required",
      command.requestId,
    );
  const recording = command.action === "RECORD" || command.action === "REPLACE";
  const accepted = recording ? command.acceptedDeltaBase : 0,
    rejected = recording ? command.rejectedDeltaBase : 0,
    shortage = recording ? (command.shortageDeltaBase ?? 0) : 0;
  if (
    recording &&
    (!Number.isSafeInteger(accepted) ||
      !Number.isSafeInteger(rejected) ||
      accepted < 0 ||
      rejected < 0 ||
      !Number.isSafeInteger(shortage) ||
      shortage < 0 ||
      !Number.isSafeInteger(accepted + rejected + shortage) ||
      accepted + rejected + shortage === 0 ||
      (command.action === "REPLACE" && (rejected !== 0 || shortage !== 0 || accepted === 0)) ||
      ((shortage > 0 || command.action === "REPLACE") && !command.reason?.trim()))
  )
    return failure(
      "VALIDATION_FAILED",
      "Received quantities must be positive integer base-unit deltas",
      command.requestId,
    );
  const row = await database
    .prepare(`SELECT receipt.id,receipt.procurement_requirement_id requirementId,requirement.delivery_cycle_id cycleId,requirement.location_id locationId,requirement.inventory_pool_id inventoryPoolId,
    receipt.expected_quantity expectedBase,receipt.accepted_quantity acceptedBase,receipt.rejected_quantity rejectedBase,receipt.legacy_accepted_base legacyAcceptedBase,
    receipt.shortage_base shortageBase,receipt.replacement_base replacementBase,
    receipt.status,receipt.version,requirement.status requirementStatus,requirement.version requirementVersion
    FROM receiving_record receipt JOIN procurement_requirement requirement ON requirement.id=receipt.procurement_requirement_id
    WHERE ${command.action === "START" ? "receipt.procurement_requirement_id" : "receipt.id"}=? ORDER BY receipt.rowid LIMIT 1`)
    .bind(command.action === "START" ? command.requirementId : command.receivingRecordId)
    .first<Receipt>();
  if (!row || (command.authority && row.locationId !== command.authority.locationId))
    return failure("NOT_FOUND", "Receiving record not found at this location", command.requestId);
  const scope =
    command.action === "START"
      ? "procurement.startReceiving"
      : command.action === "REPLACE"
        ? "procurement.receiveReplacement"
        : command.action === "RECORD"
          ? "procurement.recordReceivedLine"
          : "procurement.completeReceiving";
  const legacyPayload =
    command.action === "START"
      ? { requirementId: command.requirementId, expectedVersion: command.expectedVersion }
      : recording
        ? {
            receivingRecordId: command.receivingRecordId,
            acceptedDeltaBase: accepted,
            rejectedDeltaBase: rejected,
            ...(shortage > 0 ? { shortageDeltaBase: shortage } : {}),
            reason: command.reason ?? "",
            expectedVersion: command.expectedVersion,
          }
        : {
            receivingRecordId: command.receivingRecordId,
            expectedVersion: command.expectedVersion,
          };
  const legacyHash = await requestHash(legacyPayload),
    hash = await requestHash({
      ...legacyPayload,
      action: command.action,
      actor: command.authority?.authUserId ?? null,
      reason: command.reason ?? null,
    });
  async function replay(): Promise<Result | null> {
    const saved = await findIdempotencyRecord(database, scope, command.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash && saved.requestHash !== legacyHash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "This key belongs to different receiving details",
        command.requestId,
      );
    if (saved.status === "SUCCEEDED") {
      if (!saved.resultReference?.startsWith("{"))
        return failure(
          "CONFLICT",
          "This historical receipt command was already applied; review its receiving history",
          command.requestId,
        );
      return {
        ok: true,
        requestId: command.requestId,
        value: resultSchema.parse(JSON.parse(saved.resultReference)),
      };
    }
    // Original receiving batches completed their result with the mutation. A retained unapplied
    // claim can be reclaimed only together with the same guarded receipt/requirement versions.
    return null;
  }
  const prior = await replay();
  if (prior) return prior;
  if (row.version !== command.expectedVersion)
    return failure(
      "STALE_VERSION",
      "Receiving changed; refresh before retrying",
      command.requestId,
    );
  if (
    !receivingActions({
      status: row.status,
      requirementStatus: row.requirementStatus,
      expected: row.expectedBase,
      accepted: row.acceptedBase,
      rejected: row.rejectedBase,
      shortage: row.shortageBase,
      replacement: row.replacementBase,
    }).includes(command.action)
  )
    return failure(
      "ILLEGAL_TRANSITION",
      "This receiving action is not available for the current requirement and receipt",
      command.requestId,
    );
  const acceptedBase = row.acceptedBase + accepted,
    rejectedBase = row.rejectedBase + rejected,
    shortageBase = row.shortageBase + shortage,
    replacementBase = row.replacementBase + (command.action === "REPLACE" ? accepted : 0);
  const accounted = acceptedBase + rejectedBase + shortageBase - replacementBase;
  if (
    ![acceptedBase, rejectedBase, shortageBase, replacementBase, accounted].every(
      Number.isSafeInteger,
    ) ||
    accounted > row.expectedBase ||
    acceptedBase > row.expectedBase
  )
    return failure(
      "VALIDATION_FAILED",
      "Received quantities exceed the expected quantity",
      command.requestId,
    );
  const complete = accounted === row.expectedBase;
  const status =
    command.action === "START"
      ? "IN_PROGRESS"
      : command.action === "COMPLETE"
        ? "COMPLETED"
        : complete && acceptedBase === row.expectedBase
          ? "COMPLETED"
          : rejectedBase > 0 || shortageBase > 0
            ? "DISCREPANCY"
            : "IN_PROGRESS";
  const result: ReceivingResult = {
    receivingRecordId: row.id,
    requirementId: row.requirementId,
    cycleId: row.cycleId,
    locationId: row.locationId,
    expectedBase: row.expectedBase,
    legacyAcceptedBase: row.legacyAcceptedBase,
    status,
    acceptedBase,
    rejectedBase,
    shortageBase,
    replacementBase,
    remainingBase: row.expectedBase - accounted,
    version: row.version + 1,
    inventoryVersion: null,
  };
  const now = Date.now(),
    statements: D1PreparedStatement[] = [];
  const exceptionPrefix = `receipt:${row.id}:`;
  const openExceptions =
    command.action === "REPLACE"
      ? await database
          .prepare(
            "SELECT COUNT(*) count FROM supply_exception WHERE requirement_id=? AND status='OPEN' AND substr(id,1,?)=?",
          )
          .bind(row.requirementId, exceptionPrefix.length, exceptionPrefix)
          .first<{ count: number }>()
      : null;
  if (command.action === "REPLACE" && (!openExceptions?.count || row.legacyAcceptedBase > 0))
    return failure(
      "ILLEGAL_TRANSITION",
      "This retained receipt needs its original stock and discrepancy evidence reviewed before replacement receiving",
      command.requestId,
    );
  if (command.authority)
    statements.push(
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -36 WHERE NOT EXISTS (
    SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id AND p.code='procurement.manage'
    JOIN staff_scope scope ON scope.staff_id=staff.id JOIN fulfillment_location location ON location.id=?
    WHERE staff.auth_user_id=? AND staff.status='active' AND (scope.scope_kind='global' OR (scope.scope_kind='market' AND scope.market_id=location.market_id) OR (scope.scope_kind='location' AND scope.location_id=location.id)))`)
        .bind(row.locationId, command.authority.authUserId),
    );
  if (command.action === "REPLACE")
    statements.push(
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -36 WHERE (SELECT COUNT(*) FROM supply_exception WHERE requirement_id=? AND status='OPEN' AND substr(id,1,?)=?)<>?",
        )
        .bind(
          row.requirementId,
          exceptionPrefix.length,
          exceptionPrefix,
          openExceptions?.count ?? 0,
        ),
    );
  statements.push(
    database
      .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','receiving_result',?,?)
      ON CONFLICT(scope,idempotency_key) DO UPDATE SET request_hash=excluded.request_hash,status='PROCESSING',result_reference=NULL,updated_at=excluded.updated_at
      WHERE idempotency_records.status IN ('FAILED','PROCESSING') AND idempotency_records.request_hash IN (?,?)`)
      .bind(scope, command.idempotencyKey, hash, now, now, hash, legacyHash),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()<>1"),
    database
      .prepare(
        `INSERT INTO commitment_abort(id) SELECT -36 WHERE NOT EXISTS (SELECT 1 FROM procurement_requirement WHERE id=? AND version=? AND status=? AND delivery_cycle_id=? AND location_id=? AND inventory_pool_id=?)`,
      )
      .bind(
        row.requirementId,
        row.requirementVersion,
        row.requirementStatus,
        row.cycleId,
        row.locationId,
        row.inventoryPoolId,
      ),
    database
      .prepare(
        "UPDATE receiving_record SET accepted_quantity=?,rejected_quantity=?,shortage_base=?,replacement_base=?,status=?,version=version+1,updated_at=? WHERE id=? AND procurement_requirement_id=? AND version=? AND status=? AND accepted_quantity=? AND rejected_quantity=? AND expected_quantity=? AND shortage_base=? AND replacement_base=?",
      )
      .bind(
        acceptedBase,
        rejectedBase,
        shortageBase,
        replacementBase,
        status,
        now,
        row.id,
        row.requirementId,
        row.version,
        row.status,
        row.acceptedBase,
        row.rejectedBase,
        row.expectedBase,
        row.shortageBase,
        row.replacementBase,
      ),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()<>1"),
  );
  if (recording) {
    const eventId = crypto.randomUUID();
    if (accepted + rejected > 0)
      statements.push(
        database
          .prepare(
            "INSERT INTO receiving_event(id,receiving_record_id,procurement_requirement_id,location_id,inventory_pool_id,accepted_delta,rejected_delta,reason,idempotency_key,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            eventId,
            row.id,
            row.requirementId,
            row.locationId,
            row.inventoryPoolId,
            accepted,
            rejected,
            command.reason ?? null,
            command.idempotencyKey,
            now,
          ),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()<>1"),
      );
    if (accepted > 0)
      statements.push(
        database
          .prepare(
            "INSERT INTO cycle_goods_balance(cycle_id,location_id,inventory_pool_id,received_base,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(cycle_id,location_id,inventory_pool_id) DO UPDATE SET received_base=received_base+excluded.received_base,version=version+1,updated_at=excluded.updated_at",
          )
          .bind(row.cycleId, row.locationId, row.inventoryPoolId, accepted, now),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()<>1"),
        database
          .prepare(
            "INSERT INTO cycle_goods_movement(id,cycle_id,location_id,inventory_pool_id,movement_type,quantity_base,receiving_event_id,actor_user_id,reason,idempotency_key,occurred_at) VALUES (?,?,?,?,'RECEIPT',?,?,?,?,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            row.cycleId,
            row.locationId,
            row.inventoryPoolId,
            accepted,
            eventId,
            command.authority?.authUserId ?? null,
            command.reason ?? null,
            `receipt:${eventId}`,
            now,
          ),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()<>1"),
      );
    for (const [kind, quantity] of [
      ["QUALITY", rejected],
      ["SHORTAGE", shortage],
    ] as const) {
      if (quantity === 0) continue;
      statements.push(
        database
          .prepare(
            "INSERT INTO supply_exception(id,requirement_id,kind,affected_quantity,status,resolution,created_at,version) VALUES (?,?,?,?,'OPEN',NULL,?,1)",
          )
          .bind(`receipt:${row.id}:${kind}:${eventId}`, row.requirementId, kind, quantity, now),
        database.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()<>1"),
      );
    }
    if (command.action === "REPLACE" && acceptedBase === row.expectedBase) {
      statements.push(
        database
          .prepare(
            "UPDATE supply_exception SET status='RESOLVED',resolution='REPLACEMENT_RECEIVED',version=version+1 WHERE requirement_id=? AND status='OPEN' AND substr(id,1,?)=?",
          )
          .bind(row.requirementId, exceptionPrefix.length, exceptionPrefix),
        database
          .prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()<>?")
          .bind(openExceptions?.count ?? 0),
      );
    }
    const requirementStatus = !complete
      ? "PARTIALLY_RECEIVED"
      : acceptedBase === 0
        ? "EXCEPTION"
        : "RECEIVED";
    statements.push(
      database
        .prepare(
          "UPDATE procurement_requirement SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?",
        )
        .bind(requirementStatus, now, row.requirementId, row.requirementVersion),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()<>1"),
    );
  }
  statements.push(
    auditEventStatement(database, {
      actorUserId: command.authority?.authUserId ?? null,
      action:
        command.action === "START"
          ? "OPERATIONS.RECEIVING_STARTED"
          : command.action === "REPLACE"
            ? "OPERATIONS.REPLACEMENT_RECEIVED"
            : command.action === "RECORD"
              ? "OPERATIONS.RECEIVING_LINE_RECORDED"
              : "OPERATIONS.RECEIVING_COMPLETED",
      resourceType: "receiving_record",
      resourceId: row.id,
      locationId: row.locationId,
      reason: command.reason ?? null,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.requestId,
      occurredAt: now,
      before: {
        status: row.status,
        version: row.version,
        acceptedBase: row.acceptedBase,
        rejectedBase: row.rejectedBase,
        shortageBase: row.shortageBase,
        replacementBase: row.replacementBase,
      },
      after: {
        status,
        version: result.version,
        acceptedBase,
        rejectedBase,
        shortageBase,
        replacementBase,
      },
    }),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()<>1"),
    database
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
      )
      .bind(JSON.stringify(result), now, scope, command.idempotencyKey, hash),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()<>1"),
  );
  try {
    await database.batch(statements);
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    if (
      error instanceof Error &&
      /CHECK constraint failed|UNIQUE constraint failed/.test(error.message)
    )
      return failure(
        "STALE_VERSION",
        "Receipt, requirement or access changed; refresh and review",
        command.requestId,
      );
    throw error;
  }
  return { ok: true, value: result, requestId: command.requestId };
}
