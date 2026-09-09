import { stockSortingStatements } from "../infrastructure/stock-sorting-repository";
import type {
  AppErrorCode,
  InventoryTransferResult,
  InventoryTransferPage,
  InventoryTransferView,
  InventoryTransferOptions,
  InventoryTransferStatus,
  InventoryTransferLineView,
  InventoryDistributionPage,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  z,
  createInventoryTransferSchema,
  inventoryTransferCommandSchema,
  receiveInventoryTransferSchema,
  inventoryTransferListSchema,
  inventoryTransferOptionsSchema,
  inventoryTransferResultSchema,
  resolveInventoryTransferSchema,
  inventoryDistributionSchema,
  inventoryDistributionPageSchema,
} from "@freshmarkets/validation";
import { requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { readInventoryDistribution } from "../infrastructure/distribution-read-model";
import { createTransferRepository } from "../infrastructure/transfer-repository";

/** One authenticated Inventory operation; browser identity and authority never enter the payload. */
export function inventoryTransfers(
  db: D1Database,
  actorUserId: string,
  requestId: string,
  now: number,
) {
  const repository = createTransferRepository(db);
  const fail = (code: AppErrorCode, message: string) => ({
    ok: false as const,
    error: { code, message, requestId },
  });
  const success = <T>(value: T): RpcResult<T> => ({ ok: true, value, requestId });
  const invalid = () =>
    fail("VALIDATION_FAILED", "Check the transfer, quantities, version and reason");
  async function replay(
    scope: string,
    key: string,
    hash: string,
  ): Promise<RpcResult<InventoryTransferResult> | null> {
    const saved = await repository.receipt(scope, key);
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return fail("IDEMPOTENCY_CONFLICT", "This key belongs to another transfer action");
    if (saved.status !== "SUCCEEDED" || !saved.resultReference)
      return fail("CONFLICT", "The recorded transfer action is incomplete");
    let value: unknown;
    try {
      value = JSON.parse(saved.resultReference);
    } catch {
      return fail("CONFLICT", "The recorded transfer result is unreadable");
    }
    const parsed = inventoryTransferResultSchema.safeParse(value);
    return parsed.success
      ? success(parsed.data)
      : fail("CONFLICT", "The recorded transfer result is invalid");
  }
  async function commit(input: {
    action: string;
    key: string;
    hash: string;
    scopeLocationId: string | null;
    reason: string;
    result: InventoryTransferResult;
    effects: readonly D1PreparedStatement[];
  }): Promise<RpcResult<InventoryTransferResult>> {
    const scope = `inventory.transfer.${input.action}`;
    try {
      await repository.commit({
        actorUserId,
        scopeLocationId: input.scopeLocationId,
        scope,
        key: input.key,
        hash: input.hash,
        result: JSON.stringify(input.result),
        now,
        effects: input.effects,
        audit: auditEventStatement(db, {
          actorUserId,
          action: `INVENTORY.TRANSFER_${input.action.toUpperCase()}`,
          resourceType: "inventory_transfer",
          resourceId: input.result.transferId,
          reason: input.reason,
          idempotencyKey: input.key,
          correlationId: requestId,
          occurredAt: now,
          locationId: input.scopeLocationId,
          after: input.result,
        }),
      });
    } catch (error) {
      const saved = await replay(scope, input.key, input.hash);
      if (saved) return saved;
      if (
        error instanceof Error &&
        /CHECK constraint failed|UNIQUE constraint failed/.test(error.message)
      )
        return fail(
          "CONFLICT",
          "Stock, transfer state or authority changed; refresh and try again",
        );
      throw error;
    }
    return success(input.result);
  }
  async function command(
    input: unknown,
    action: "dispatch" | "receive" | "cancel",
  ): Promise<RpcResult<InventoryTransferResult>> {
    const parsed =
      action === "receive"
        ? receiveInventoryTransferSchema.safeParse(input)
        : inventoryTransferCommandSchema.safeParse(input);
    if (!parsed.success) return invalid();
    const request = parsed.data;
    const transfer = await repository.read(request.transferId);
    if (!transfer) return fail("NOT_FOUND", "Transfer not found");
    const scopeLocationId = action === "receive" ? transfer.destinationLocationId : null;
    if (!(await repository.hasAuthority(actorUserId, "transfers.manage", scopeLocationId)))
      return fail(
        "FORBIDDEN",
        "Transfer capability and the required Global or destination scope are required",
      );
    const { idempotencyKey, ...payload } = request;
    const hash = await requestHash({ ...payload, actorUserId });
    const previous = await replay(`inventory.transfer.${action}`, idempotencyKey, hash);
    if (previous) return previous;
    if (transfer.version !== request.expectedVersion)
      return fail("STALE_VERSION", "Transfer changed; refresh before trying again");
    if (action !== "receive" && transfer.status !== "DRAFT")
      return fail("ILLEGAL_TRANSITION", "Only a draft transfer can be dispatched or canceled");
    if (
      action === "receive" &&
      transfer.status !== "IN_TRANSIT" &&
      transfer.status !== "PARTIALLY_RECEIVED"
    )
      return fail("ILLEGAL_TRANSITION", "Only outstanding dispatched goods can be received");
    const lines = await repository.lines(transfer.transferId);
    if (!lines.length) return fail("CONFLICT", "Transfer has no lines");
    let status: InventoryTransferStatus;
    const effects: D1PreparedStatement[] = [];
    if (action === "dispatch") {
      if (!(await repository.validRoute(transfer.sourceLocationId, transfer.destinationLocationId)))
        return fail(
          "CONFIGURATION_ERROR",
          "Activate the warehouse and destination and configure warehouse receiving and storage",
        );
      const available = await repository.available(
        transfer.sourceLocationId,
        lines.map((line) => line.inventoryPoolId),
      );
      if (lines.some((line) => (available.get(line.inventoryPoolId) ?? 0) < line.quantityBase))
        return fail(
          "INSUFFICIENT_STOCK",
          "The warehouse does not have enough stock after holds and reservations",
        );
      status = "IN_TRANSIT";
      effects.push(
        repository.routeGuard(transfer.sourceLocationId, transfer.destinationLocationId),
      );
      for (const line of lines)
        effects.push(
          ...repository.dispatchLineStatements({
            transferId: transfer.transferId,
            sourceLocationId: transfer.sourceLocationId,
            actorUserId,
            now,
            reason: request.reason,
            line,
            effectKey: `transfer:dispatch:${idempotencyKey}:${line.lineId}`,
          }),
        );
    } else if (action === "receive") {
      // The parsed receive schema is independently narrowed, rather than asserted from the action string.
      const receipt = receiveInventoryTransferSchema.safeParse(request);
      if (!receipt.success) return invalid();
      const byId = new Map(lines.map((line) => [line.lineId, line]));
      for (const received of receipt.data.lines) {
        const line = byId.get(received.lineId);
        if (!line)
          return fail("VALIDATION_FAILED", "A receipt line does not belong to this transfer");
        if (received.acceptedBase > line.outstandingBase)
          return fail("VALIDATION_FAILED", "Accepted quantity exceeds outstanding transit");
      }
      const accepted = new Map(receipt.data.lines.map((line) => [line.lineId, line]));
      for (const line of lines) {
        const received = accepted.get(line.lineId);
        if (!received) continue;
        const remaining = line.outstandingBase - received.acceptedBase;
        if (
          (received.damagedBase ?? line.damagedBase) +
            (received.shortageBase ?? line.shortageBase) >
          remaining
        )
          return fail(
            "VALIDATION_FAILED",
            "Remaining damaged and missing quantities exceed outstanding goods after acceptance",
          );
      }
      status = accountedStatus(
        lines.map((line) => ({
          ...line,
          acceptedBase: line.acceptedBase + (accepted.get(line.lineId)?.acceptedBase ?? 0),
        })),
      );
      for (const received of receipt.data.lines) {
        const line = byId.get(received.lineId);
        if (!line) return invalid();
        effects.push(
          ...repository.receiveLineStatements({
            transferId: transfer.transferId,
            destinationLocationId: transfer.destinationLocationId,
            actorUserId,
            now,
            reason: request.reason,
            line,
            acceptedBase: received.acceptedBase,
            damagedBase: received.damagedBase ?? line.damagedBase,
            shortageBase: received.shortageBase ?? line.shortageBase,
            effectKey: `transfer:receive:${idempotencyKey}:${line.lineId}`,
          }),
        );
        if (received.sizeCounts) {
          if (received.acceptedBase === 0)
            return fail("VALIDATION_FAILED", "Count only newly accepted goods in this receipt");
          const product = await db
            .prepare("SELECT id FROM product WHERE inventory_pool_id=?")
            .bind(line.inventoryPoolId)
            .first<{ id: string }>();
          if (!product) return invalid();
          const sorting = await stockSortingStatements(db, {
            productId: product.id,
            locationId: transfer.destinationLocationId,
            quantityGrams: received.acceptedBase,
            sizeCounts: received.sizeCounts,
            actorUserId,
            reason: request.reason,
            now,
            effectKey: `transfer:sort:${idempotencyKey}:${line.lineId}`,
            receiptEffectKey: `transfer:receive:${idempotencyKey}:${line.lineId}`,
          });
          if (!sorting)
            return fail(
              "VALIDATION_FAILED",
              "Select actual sizes belonging to this counted product",
            );
          effects.push(...sorting.statements);
        }
      }
    } else status = "CANCELED";
    effects.unshift(
      ...repository.transitionStatements(
        transfer.transferId,
        transfer.status,
        transfer.version,
        status,
        now,
      ),
    );
    return commit({
      action,
      key: idempotencyKey,
      hash,
      scopeLocationId,
      reason: request.reason,
      result: { transferId: transfer.transferId, status, version: transfer.version + 1 },
      effects,
    });
  }
  return {
    async create(input: unknown): Promise<RpcResult<InventoryTransferResult>> {
      const parsed = createInventoryTransferSchema.safeParse(input);
      if (!parsed.success) return invalid();
      if (!(await repository.hasAuthority(actorUserId, "transfers.manage")))
        return fail("FORBIDDEN", "Global transfer management is required");
      const request = parsed.data,
        { idempotencyKey, ...payload } = request;
      const hash = await requestHash({ ...payload, actorUserId });
      const previous = await replay("inventory.transfer.create", idempotencyKey, hash);
      if (previous) return previous;
      if (!(await repository.validRoute(request.sourceLocationId, request.destinationLocationId)))
        return fail(
          "CONFIGURATION_ERROR",
          "Select an active warehouse with receiving/storage and an active customer fulfillment destination",
        );
      const pools = await repository.pools(request.lines.map((line) => line.inventoryPoolId)),
        byId = new Map(pools.map((pool) => [pool.inventoryPoolId, pool]));
      if (pools.length !== request.lines.length)
        return fail("VALIDATION_FAILED", "Select existing GRAM or PIECE product pools");
      const lines = [];
      for (const line of request.lines) {
        const pool = byId.get(line.inventoryPoolId);
        if (!pool) return invalid();
        lines.push({ ...pool, quantityBase: line.quantityBase, lineId: crypto.randomUUID() });
      }
      const transferId = crypto.randomUUID();
      return commit({
        action: "create",
        key: idempotencyKey,
        hash,
        scopeLocationId: null,
        reason: request.reason,
        result: { transferId, status: "DRAFT", version: 1 },
        effects: [
          repository.routeGuard(request.sourceLocationId, request.destinationLocationId),
          ...repository.createStatements({
            transferId,
            sourceLocationId: request.sourceLocationId,
            destinationLocationId: request.destinationLocationId,
            reason: request.reason,
            actorUserId,
            now,
            lines,
          }),
        ],
      });
    },
    async resolve(input: unknown): Promise<RpcResult<InventoryTransferResult>> {
      const parsed = resolveInventoryTransferSchema.safeParse(input);
      if (!parsed.success)
        return fail(
          "VALIDATION_FAILED",
          "Check the quantity/category and confirm physical receipt and sellable inspection for a return",
        );
      if (!(await repository.hasAuthority(actorUserId, "transfers.manage")))
        return fail(
          "FORBIDDEN",
          "Global transfer management is required to resolve a loss or return",
        );
      const request = parsed.data,
        { idempotencyKey, ...payload } = request,
        hash = await requestHash({ ...payload, actorUserId });
      const previous = await replay("inventory.transfer.resolve", idempotencyKey, hash);
      if (previous) return previous;
      const transfer = await repository.read(request.transferId);
      if (!transfer) return fail("NOT_FOUND", "Transfer not found");
      if (transfer.version !== request.expectedVersion)
        return fail("STALE_VERSION", "Transfer changed; refresh before resolving");
      if (transfer.status !== "IN_TRANSIT" && transfer.status !== "PARTIALLY_RECEIVED")
        return fail("ILLEGAL_TRANSITION", "Only outstanding dispatched goods can be resolved");
      const lines = await repository.lines(transfer.transferId),
        line = lines.find((line) => line.lineId === request.lineId);
      if (!line) return fail("VALIDATION_FAILED", "Select a line belonging to this transfer");
      const available =
        request.category === "DAMAGED"
          ? line.damagedBase
          : request.category === "MISSING"
            ? line.shortageBase
            : line.outstandingBase - line.damagedBase - line.shortageBase;
      if (request.quantityBase > available)
        return fail(
          "VALIDATION_FAILED",
          "Resolution quantity exceeds the selected outstanding category",
        );
      const status = accountedStatus(
        lines.map((item) =>
          item.lineId === line.lineId
            ? {
                ...item,
                lostBase: item.lostBase + (request.outcome === "LOSS" ? request.quantityBase : 0),
                returnedBase:
                  item.returnedBase +
                  (request.outcome === "VERIFIED_RETURN" ? request.quantityBase : 0),
              }
            : item,
        ),
      );
      return commit({
        action: "resolve",
        key: idempotencyKey,
        hash,
        scopeLocationId: null,
        reason: request.reason,
        result: { transferId: transfer.transferId, status, version: transfer.version + 1 },
        effects: [
          ...repository.transitionStatements(
            transfer.transferId,
            transfer.status,
            transfer.version,
            status,
            now,
          ),
          ...repository.resolveLineStatements({
            transferId: transfer.transferId,
            sourceLocationId: transfer.sourceLocationId,
            destinationLocationId: transfer.destinationLocationId,
            actorUserId,
            now,
            reason: request.reason,
            effectKey: `transfer:resolve:${idempotencyKey}:${line.lineId}`,
            line,
            quantityBase: request.quantityBase,
            category: request.category,
            outcome: request.outcome,
            inspectionConfirmed: request.inspectionConfirmed === true,
          }),
        ],
      });
    },
    async distribution(input: unknown): Promise<RpcResult<InventoryDistributionPage>> {
      const parsed = inventoryDistributionSchema.safeParse(input);
      if (!parsed.success) return invalid();
      if (!(await repository.hasAuthority(actorUserId, "transfers.read")))
        return fail("FORBIDDEN", "Global transfer read capability is required");
      const rows = await readInventoryDistribution(db, {
        ...parsed.data,
        limit: (parsed.data.limit ?? 25) + 1,
      });
      const limit = parsed.data.limit ?? 25,
        items = rows.slice(0, limit),
        last = items.at(-1);
      const result = inventoryDistributionPageSchema.safeParse({
        items,
        nextCursor: rows.length > limit && last ? last.inventoryPoolId : null,
      });
      if (!result.success)
        return fail("CONFLICT", "Inventory totals are outside the supported whole-unit range");
      return success(result.data);
    },
    dispatch: (input: unknown) => command(input, "dispatch"),
    receive: (input: unknown) => command(input, "receive"),
    cancel: (input: unknown) => command(input, "cancel"),
    async get(transferId: string): Promise<RpcResult<InventoryTransferView>> {
      const transfer = await repository.read(transferId);
      if (
        !transfer ||
        !(
          (await repository.hasAuthority(
            actorUserId,
            "transfers.read",
            transfer.destinationLocationId,
          )) ||
          (await repository.hasAuthority(actorUserId, "transfers.read", transfer.sourceLocationId))
        )
      )
        return fail("NOT_FOUND", "Transfer not found");
      const global = await repository.hasAuthority(actorUserId, "transfers.manage"),
        receiver = await repository.hasAuthority(
          actorUserId,
          "transfers.manage",
          transfer.destinationLocationId,
        );
      const active = transfer.status === "IN_TRANSIT" || transfer.status === "PARTIALLY_RECEIVED";
      const allowedActions: InventoryTransferView["allowedActions"] =
        transfer.status === "DRAFT" && global
          ? ["DISPATCH", "CANCEL"]
          : [
              ...(active && receiver ? ["RECEIVE" as const] : []),
              ...(active && global ? ["RESOLVE" as const] : []),
            ];
      const sizeOptions = await db
        .prepare(`SELECT l.id lineId,s.id skuId,s.name FROM inventory_transfer_line l
        JOIN product p ON p.inventory_pool_id=l.inventory_pool_id JOIN sku s ON s.product_id=p.id
        WHERE l.transfer_id=? AND p.stock_tracking='COUNTED_SIZES' AND s.stock_pool_id IS NOT NULL AND s.status='active' ORDER BY s.sort_order,s.id`)
        .bind(transferId)
        .all<{ lineId: string; skuId: string; name: string }>();
      const sorting = await db
        .prepare(`SELECT so.id sortId,r.line_id lineId,so.quantity_grams quantityGrams,o.sku_name skuName,o.quantity_pieces quantity
        FROM inventory_sort so JOIN inventory_transfer_receipt r ON r.id=so.transfer_receipt_id
        JOIN inventory_sort_output o ON o.sort_id=so.id WHERE r.transfer_id=? ORDER BY so.created_at DESC,so.id,o.sku_id LIMIT 500`)
        .bind(transferId)
        .all<{
          sortId: string;
          lineId: string;
          quantityGrams: number;
          skuName: string;
          quantity: number;
        }>();
      return success({
        ...transfer,
        sorting: sorting.results,
        lines: (await repository.lines(transferId)).map((line) => ({
          ...line,
          sizeOptions: sizeOptions.results
            .filter((size) => size.lineId === line.lineId)
            .map(({ skuId, name }) => ({ skuId, name })),
        })),
        receipts: await repository.receipts(transferId),
        checks: await repository.checks(transferId),
        resolutions: await repository.resolutions(transferId),
        allowedActions,
      });
    },
    async list(input: unknown): Promise<RpcResult<InventoryTransferPage>> {
      const parsed = inventoryTransferListSchema.safeParse(input);
      if (!parsed.success) return invalid();
      const request = parsed.data;
      if (
        !(await repository.hasAuthority(actorUserId, "transfers.read", request.locationId ?? null))
      )
        return fail("FORBIDDEN", "Transfer read capability and scope are required");
      let cursor: { createdAt: number; id: string } | undefined;
      if (request.cursor) {
        try {
          cursor = z
            .object({
              createdAt: z.number().int().safe().nonnegative(),
              id: z.string().min(1).max(200),
            })
            .parse(JSON.parse(atob(request.cursor)));
        } catch {
          return fail("VALIDATION_FAILED", "Transfer cursor is invalid");
        }
      }
      const limit = request.limit ?? 25,
        items = await repository.list({ ...request, cursor, limit: limit + 1 }),
        page = items.slice(0, limit),
        last = page.at(-1);
      return success({
        items: page,
        nextCursor:
          items.length > limit && last
            ? btoa(JSON.stringify({ createdAt: last.createdAt, id: last.transferId }))
            : null,
        canCreate: await repository.hasAuthority(actorUserId, "transfers.manage"),
      });
    },
    async options(input: unknown): Promise<RpcResult<InventoryTransferOptions>> {
      const parsed = inventoryTransferOptionsSchema.safeParse(input);
      if (!parsed.success) return invalid();
      if (!(await repository.hasAuthority(actorUserId, "transfers.read")))
        return fail("FORBIDDEN", "Global transfer read capability is required");
      return success(
        await repository.options(parsed.data.sourceLocationId, parsed.data.query ?? ""),
      );
    },
  };
}

function accountedStatus(lines: readonly InventoryTransferLineView[]): InventoryTransferStatus {
  if (
    lines.every(
      (line) => line.quantityBase - line.acceptedBase - line.lostBase - line.returnedBase === 0,
    )
  )
    return lines.every((line) => line.acceptedBase === line.quantityBase) ? "RECEIVED" : "RESOLVED";
  return lines.some((line) => line.acceptedBase > 0) ? "PARTIALLY_RECEIVED" : "IN_TRANSIT";
}
