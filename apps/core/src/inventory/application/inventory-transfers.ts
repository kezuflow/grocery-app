import type {
  AppErrorCode,
  InventoryTransferResult,
  InventoryTransferPage,
  InventoryTransferView,
  InventoryTransferOptions,
  InventoryTransferStatus,
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
} from "@freshmarkets/validation";
import { requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
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
      const accepted = new Map(receipt.data.lines.map((line) => [line.lineId, line.acceptedBase]));
      status = lines.every((line) => (accepted.get(line.lineId) ?? 0) === line.outstandingBase)
        ? "RECEIVED"
        : "PARTIALLY_RECEIVED";
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
            effectKey: `transfer:receive:${idempotencyKey}:${line.lineId}`,
          }),
        );
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
      const allowedActions: InventoryTransferView["allowedActions"] =
        transfer.status === "DRAFT" && global
          ? ["DISPATCH", "CANCEL"]
          : (transfer.status === "IN_TRANSIT" || transfer.status === "PARTIALLY_RECEIVED") &&
              receiver
            ? ["RECEIVE"]
            : [];
      return success({
        ...transfer,
        lines: await repository.lines(transferId),
        receipts: await repository.receipts(transferId),
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
