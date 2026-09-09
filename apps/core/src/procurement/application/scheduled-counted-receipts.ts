import type {
  RecordScheduledCountedReceiptRequest,
  ScheduledCountedReceiptView,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  scheduledCountedReceiptBodySchema,
  scheduledCountedReceiptViewSchema,
  idempotencyKeySchema,
} from "@freshmarkets/validation";
import {
  resolveOperationsAdministrationAccess,
  type OperationsAdministrationDeps,
} from "../../admin/application/operations-administration-access";
import { prepareReceivingCommand } from "./execute-receiving-command";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
const scope = "procurement.recordCountedReceipt";
type Result = RpcResult<ScheduledCountedReceiptView>;

/** One weighed delivery records its actual size counts; grams never credit another stock balance. */
export async function recordScheduledCountedReceipt(
  deps: OperationsAdministrationDeps,
  input: RecordScheduledCountedReceiptRequest,
): Promise<Result> {
  const fail = (
    code: "VALIDATION_FAILED" | "NOT_FOUND" | "CONFLICT" | "IDEMPOTENCY_CONFLICT" | "STALE_VERSION",
    message: string,
  ): Result => ({ ok: false, error: { code, message, requestId: input.requestId } });
  const parsed = scheduledCountedReceiptBodySchema.strip().safeParse(input);
  const key = idempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success)
    return fail("VALIDATION_FAILED", "Review the received weight and actual size counts");
  const body = parsed.data;
  const commandKey = key.data;
  const access = await resolveOperationsAdministrationAccess(
    deps,
    input,
    "procurement.manage",
    body.locationId,
  );
  if (!access.ok) return access;
  const hash = await requestHash({ ...body, actor: access.value.authUserId });
  async function replay(): Promise<Result | null> {
    const saved = await findIdempotencyRecord(deps.db, scope, commandKey);
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return fail("IDEMPOTENCY_CONFLICT", "This key belongs to another weighed receipt");
    if (saved.status !== "SUCCEEDED") return null;
    if (!saved.resultReference)
      return fail("CONFLICT", "The recorded receipt result is unavailable");
    return {
      ok: true,
      value: scheduledCountedReceiptViewSchema.parse(JSON.parse(saved.resultReference)),
      requestId: input.requestId,
    };
  }
  const prior = await replay();
  if (prior) return prior;
  if (new Set(body.lines.map((line) => line.receivingSessionId)).size !== body.lines.length)
    return fail("VALIDATION_FAILED", "Each size receipt may be included only once");
  const arrived = body.lines.reduce((sum, line) => sum + line.acceptedBase + line.rejectedBase, 0);
  if (!Number.isSafeInteger(arrived) || (arrived === 0) !== (body.receivedWeightGrams === 0))
    return fail(
      "VALIDATION_FAILED",
      "Record the measured weight when goods arrived; a wholly missing delivery has zero received weight",
    );
  const marks = body.lines.map(() => "?").join(",");
  const metadata = await deps.db
    .prepare(`SELECT rr.id receivingSessionId,s.id skuId,s.name variantName,p.name productName,c.name cycleName
    FROM receiving_record rr JOIN procurement_requirement pr ON pr.id=rr.procurement_requirement_id
    JOIN delivery_cycle c ON c.id=pr.delivery_cycle_id
    JOIN sku s ON s.id=pr.sku_id JOIN product p ON p.id=s.product_id
    JOIN inventory_pool pool ON pool.id=pr.inventory_pool_id JOIN unit u ON u.id=pool.base_unit_id
    WHERE rr.id IN (${marks}) AND pr.location_id=? AND pr.delivery_cycle_id=? AND p.id=?
      AND p.stock_tracking='COUNTED_SIZES' AND s.stock_pool_id=pr.inventory_pool_id AND u.code='PIECE'`)
    .bind(
      ...body.lines.map((line) => line.receivingSessionId),
      body.locationId,
      body.cycleId,
      body.productId,
    )
    .all<{
      receivingSessionId: string;
      skuId: string;
      variantName: string;
      productName: string;
      cycleName: string;
    }>();
  if (
    metadata.results.length !== body.lines.length ||
    new Set(metadata.results.map((row) => row.skuId)).size !== body.lines.length
  )
    return fail(
      "NOT_FOUND",
      "Select distinct counted sizes for the same product, location and delivery week",
    );
  const receiptId = crypto.randomUUID(),
    now = Date.now();
  const result: ScheduledCountedReceiptView = {
    receiptId,
    cycleId: body.cycleId,
    productId: body.productId,
    productName: metadata.results[0]?.productName ?? "",
    cycleName: metadata.results[0]?.cycleName ?? "",
    receivedWeightGrams: body.receivedWeightGrams,
    receiptKind: body.receiptKind,
    receivedAt: now,
    lines: [],
  };
  const resultLines: ScheduledCountedReceiptView["lines"][number][] = [];
  const guard = () =>
    deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()<>1");
  const statements: D1PreparedStatement[] = [
    deps.db
      .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at)
    VALUES (?,?,?,'PROCESSING','scheduled_counted_receipt',?,?) ON CONFLICT(scope,idempotency_key) DO UPDATE SET status='PROCESSING',updated_at=excluded.updated_at
    WHERE idempotency_records.request_hash=excluded.request_hash AND idempotency_records.status IN ('FAILED','PROCESSING')`)
      .bind(scope, key.data, hash, now, now),
    guard(),
    deps.db
      .prepare(
        "INSERT INTO scheduled_counted_receipt(id,cycle_id,cycle_name,location_id,product_id,product_name,received_weight_grams,receipt_kind,actor_user_id,reason,idempotency_key,received_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        receiptId,
        body.cycleId,
        result.cycleName,
        body.locationId,
        body.productId,
        result.productName,
        body.receivedWeightGrams,
        body.receiptKind,
        access.value.authUserId,
        body.reason,
        key.data,
        now,
      ),
    guard(),
  ];
  for (const [index, line] of body.lines.entries()) {
    const meta = metadata.results.find((row) => row.receivingSessionId === line.receivingSessionId);
    if (!meta) return fail("NOT_FOUND", "Size receipt not found");
    const effectKey = `counted:${receiptId}:${index}`;
    const planned = await prepareReceivingCommand(
      deps.db,
      {
        action: body.receiptKind === "REPLACEMENT" ? "REPLACE" : "RECORD",
        receivingRecordId: line.receivingSessionId,
        acceptedDeltaBase: line.acceptedBase,
        rejectedDeltaBase: line.rejectedBase,
        shortageDeltaBase: line.shortageBase,
        expectedVersion: line.expectedVersion,
        idempotencyKey: effectKey,
        requestId: input.requestId,
        reason: body.reason,
        authority: { authUserId: access.value.authUserId, locationId: body.locationId },
      },
      { beginIfNotStarted: true, countedReceipt: true },
    );
    if (!planned.ok) return planned;
    if (!planned.value.statements.length)
      return fail("CONFLICT", "A receipt effect exists without its weighed receipt result");
    statements.push(
      deps.db
        .prepare(`INSERT INTO commitment_abort(id) SELECT -36 WHERE NOT EXISTS (
      SELECT 1 FROM procurement_requirement pr JOIN sku s ON s.id=pr.sku_id JOIN product p ON p.id=s.product_id
      WHERE pr.id=? AND pr.location_id=? AND pr.delivery_cycle_id=? AND p.id=? AND p.stock_tracking='COUNTED_SIZES' AND s.id=? AND s.stock_pool_id=pr.inventory_pool_id)`)
        .bind(
          planned.value.result.requirementId,
          body.locationId,
          body.cycleId,
          body.productId,
          meta.skuId,
        ),
      ...planned.value.statements,
      deps.db
        .prepare(`INSERT INTO scheduled_counted_receipt_line(receipt_id,receiving_record_id,sku_id,variant_name,receiving_event_id,shortage_base)
        VALUES (?,?,?,?,(SELECT id FROM receiving_event WHERE idempotency_key=?),?)`)
        .bind(
          receiptId,
          line.receivingSessionId,
          meta.skuId,
          meta.variantName,
          effectKey,
          line.shortageBase,
        ),
      guard(),
    );
    resultLines.push({
      receivingSessionId: line.receivingSessionId,
      skuId: meta.skuId,
      variantName: meta.variantName,
      acceptedBase: line.acceptedBase,
      rejectedBase: line.rejectedBase,
      shortageBase: line.shortageBase,
    });
  }
  result.lines = resultLines;
  statements.push(
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "OPERATIONS.COUNTED_RECEIPT_RECORDED",
      resourceType: "scheduled_counted_receipt",
      resourceId: receiptId,
      locationId: body.locationId,
      reason: body.reason,
      idempotencyKey: key.data,
      correlationId: input.requestId,
      occurredAt: now,
      before: null,
      after: result,
    }),
    guard(),
    deps.db
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
      )
      .bind(JSON.stringify(result), now, scope, key.data, hash),
    guard(),
  );
  try {
    await deps.db.batch(statements);
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    if (
      error instanceof Error &&
      /CHECK constraint failed|UNIQUE constraint failed/.test(error.message)
    )
      return fail(
        "STALE_VERSION",
        "Receiving or access changed; refresh and review the actual counts",
      );
    throw error;
  }
  return { ok: true, value: result, requestId: input.requestId };
}

/** Latest five complete weighed receipts, scoped by the already-authorized receiving query. */
export async function latestScheduledCountedReceipts(
  db: D1Database,
  locationId: string,
  cycleId?: string,
): Promise<ScheduledCountedReceiptView[]> {
  const receipts = await db
    .prepare(`SELECT id receiptId,cycle_id cycleId,cycle_name cycleName,product_id productId,product_name productName,received_weight_grams receivedWeightGrams,receipt_kind receiptKind,received_at receivedAt
    FROM scheduled_counted_receipt WHERE location_id=? ${cycleId ? "AND cycle_id=?" : ""} ORDER BY received_at DESC,id DESC LIMIT 5`)
    .bind(locationId, ...(cycleId ? [cycleId] : []))
    .all<Omit<ScheduledCountedReceiptView, "lines">>();
  if (!receipts.results.length) return [];
  const lines = await db
    .prepare(`SELECT l.receipt_id receiptId,l.receiving_record_id receivingSessionId,l.sku_id skuId,l.variant_name variantName,
    COALESCE(e.accepted_delta,0) acceptedBase,COALESCE(e.rejected_delta,0) rejectedBase,l.shortage_base shortageBase
    FROM scheduled_counted_receipt_line l LEFT JOIN receiving_event e ON e.id=l.receiving_event_id WHERE l.receipt_id IN (${receipts.results.map(() => "?").join(",")}) ORDER BY l.receipt_id,l.sku_id LIMIT 250`)
    .bind(...receipts.results.map((row) => row.receiptId))
    .all<ScheduledCountedReceiptView["lines"][number] & { receiptId: string }>();
  return receipts.results.map((row) =>
    scheduledCountedReceiptViewSchema.parse({
      ...row,
      lines: lines.results.filter((line) => line.receiptId === row.receiptId),
    }),
  );
}
