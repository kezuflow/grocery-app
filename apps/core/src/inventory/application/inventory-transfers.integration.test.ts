import { describe, expect, it, vi } from "vitest";
import { env, exports } from "cloudflare:workers";
import type { RpcResult } from "@freshmarkets/contracts";
import { locationManager } from "../../test-location-fixtures";
import { inventoryTransfers } from "./inventory-transfers";

function value<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
const pool = "pool-red-onion";
const destination = "location-cebu-central";
async function fixture() {
  const manager = await locationManager();
  const warehouse = crypto.randomUUID(),
    second = crypto.randomUUID();
  // Isolated geography fixtures; stock and all movements below use authoritative commands.
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('transfers.read','transfers.manage','inventory.adjust')",
    ).bind(manager.id),
    ...[
      [warehouse, "CENTRAL_WAREHOUSE"],
      [second, "CUSTOMER_FULFILLMENT"],
    ].map(([id, purpose]) =>
      env.DB.prepare(`INSERT INTO fulfillment_location(id,market_id,code,name,type,latitude,longitude,status,created_at,updated_at,purpose)
      VALUES (?,'market-metro-cebu',?,?,'FULFILLMENT_CENTER',10.3,123.9,'active',0,0,?)`).bind(
        id,
        id,
        purpose,
        purpose,
      ),
    ),
    env.DB.prepare(
      "INSERT INTO location_capability(location_id,capability,enabled) VALUES (?,'INVENTORY',1),(?,'RECEIVING',1)",
    ).bind(warehouse, warehouse),
  ]);
  const meta = { headers: manager.headers, requestId: crypto.randomUUID() };
  value(
    await exports.default.adjustInventory({
      ...meta,
      locationId: warehouse,
      inventoryPoolId: pool,
      delta: 100000,
      expectedVersion: 0,
      reason: "Opening stock",
      idempotencyKey: crypto.randomUUID(),
    }),
  );
  const user = await env.DB.prepare("SELECT auth_user_id id FROM staff_identity WHERE id=?")
    .bind(manager.id)
    .first<{ id: string }>();
  if (!user) throw new Error("Missing manager");
  async function create(quantityBase = 20000, destinationLocationId = destination) {
    return value(
      await exports.default.createInventoryTransfer({
        ...meta,
        sourceLocationId: warehouse,
        destinationLocationId,
        reason: "Warehouse replenishment",
        idempotencyKey: crypto.randomUUID(),
        lines: [{ inventoryPoolId: pool, quantityBase }],
      }),
    );
  }
  async function details(transferId: string) {
    return value(await exports.default.getInventoryTransfer({ ...meta, transferId }));
  }
  function command(transferId: string, expectedVersion: number) {
    return {
      ...meta,
      transferId,
      expectedVersion,
      reason: "Checked goods",
      idempotencyKey: crypto.randomUUID(),
    };
  }
  return { manager, warehouse, second, meta, userId: user.id, create, details, command };
}
async function stock(locationId: string) {
  return (
    (
      await env.DB.prepare(
        "SELECT on_hand value FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
      )
        .bind(locationId, pool)
        .first<{ value: number }>()
    )?.value ?? 0
  );
}
describe("Warehouse transfers through authenticated Core and real D1", () => {
  it("conserves 100000 grams across two destinations, partial acceptance and original retries", async () => {
    const f = await fixture(),
      cebuBefore = await stock(destination);
    for (const target of [destination, f.second]) {
      const draft = await f.create(20000, target);
      expect((await f.details(draft.transferId)).lines[0]?.outstandingBase).toBe(0);
      const dispatch = f.command(draft.transferId, 1);
      const sent = await exports.default.dispatchInventoryTransfer(dispatch);
      expect(value(sent)).toMatchObject({ status: "IN_TRANSIT", version: 2 });
      expect(await exports.default.dispatchInventoryTransfer(dispatch)).toEqual(sent);
      const line = (await f.details(draft.transferId)).lines[0];
      if (!line) throw new Error("Missing line");
      const first = {
        ...f.command(draft.transferId, 2),
        lines: [{ lineId: line.lineId, acceptedBase: 5000 }],
      };
      const accepted = await exports.default.receiveInventoryTransfer(first);
      expect(value(accepted)).toMatchObject({ status: "PARTIALLY_RECEIVED", version: 3 });
      expect(await exports.default.receiveInventoryTransfer(first)).toEqual(accepted);
      expect((await f.details(draft.transferId)).lines[0]?.outstandingBase).toBe(15000);
      value(
        await exports.default.receiveInventoryTransfer({
          ...f.command(draft.transferId, 3),
          lines: [{ lineId: line.lineId, acceptedBase: 15000 }],
        }),
      );
      expect(await exports.default.receiveInventoryTransfer(first)).toEqual(accepted);
      expect(await f.details(draft.transferId)).toMatchObject({
        status: "RECEIVED",
        version: 4,
        lines: [{ acceptedBase: 20000, outstandingBase: 0 }],
      });
    }
    expect([
      await stock(f.warehouse),
      (await stock(destination)) - cebuBefore,
      await stock(f.second),
    ]).toEqual([60000, 20000, 20000]);
  });
  it("cancels drafts without creating transit or stock effects and rejects later dispatch", async () => {
    const f = await fixture(),
      draft = await f.create();
    value(await exports.default.cancelInventoryTransfer(f.command(draft.transferId, 1)));
    expect(await stock(f.warehouse)).toBe(100000);
    expect(
      await exports.default.dispatchInventoryTransfer(f.command(draft.transferId, 2)),
    ).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
    expect((await f.details(draft.transferId)).lines[0]?.outstandingBase).toBe(0);
  });
  it("does not oversell warehouse stock when two transfers race", async () => {
    const f = await fixture(),
      a = await f.create(60000),
      b = await f.create(60000);
    const outcomes = await Promise.all(
      [a, b].map((t) => exports.default.dispatchInventoryTransfer(f.command(t.transferId, 1))),
    );
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    expect(await stock(f.warehouse)).toBe(40000);
    expect(
      (await Promise.all([a, b].map((t) => f.details(t.transferId)))).filter(
        (t) => t.status === "DRAFT",
      ),
    ).toHaveLength(1);
  });
  it("requires Global dispatch and destination-authorized receipt", async () => {
    const f = await fixture(),
      draft = await f.create(20000, f.second);
    value(await exports.default.dispatchInventoryTransfer(f.command(draft.transferId, 1)));
    await env.DB.prepare(
      "UPDATE staff_scope SET scope_kind='location',location_id=? WHERE staff_id=?",
    )
      .bind(destination, f.manager.id)
      .run();
    expect(
      await exports.default.getInventoryTransfer({ ...f.meta, transferId: draft.transferId }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      await exports.default.receiveInventoryTransfer({
        ...f.command(draft.transferId, 2),
        lines: [{ lineId: "unknown", acceptedBase: 1 }],
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      await exports.default.createInventoryTransfer({
        ...f.meta,
        sourceLocationId: f.warehouse,
        destinationLocationId: destination,
        reason: "Unauthorized",
        idempotencyKey: crypto.randomUUID(),
        lines: [{ inventoryPoolId: pool, quantityBase: 1 }],
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
  it.each(["inventory_ledger_entries", "audit_event", "idempotency_records"])(
    "rolls dispatch back when %s insertion is silently skipped",
    async (table) => {
      const f = await fixture(),
        draft = await f.create(),
        request = f.command(draft.transferId, 1);
      await env.DB.prepare(
        `CREATE TRIGGER transfer_test_skip BEFORE INSERT ON ${table} BEGIN SELECT RAISE(IGNORE); END`,
      ).run();
      try {
        expect(await exports.default.dispatchInventoryTransfer(request)).toMatchObject({
          ok: false,
          error: { code: "CONFLICT" },
        });
        expect(await stock(f.warehouse)).toBe(100000);
        expect(await f.details(draft.transferId)).toMatchObject({ status: "DRAFT", version: 1 });
        expect(
          await env.DB.prepare("SELECT 1 FROM idempotency_records WHERE idempotency_key=?")
            .bind(request.idempotencyKey)
            .first(),
        ).toBeNull();
      } finally {
        await env.DB.prepare("DROP TRIGGER transfer_test_skip").run();
      }
    },
  );
  it("recovers the original committed result when the D1 response is lost", async () => {
    const f = await fixture(),
      draft = await f.create(),
      request = f.command(draft.transferId, 1);
    const { headers: _headers, requestId, ...payload } = request;
    const batch = env.DB.batch.bind(env.DB);
    const spy = vi.spyOn(env.DB, "batch").mockImplementationOnce(async (statements) => {
      await batch(statements);
      throw new Error("Lost committed response");
    });
    try {
      expect(
        value(await inventoryTransfers(env.DB, f.userId, requestId, Date.now()).dispatch(payload)),
      ).toMatchObject({ status: "IN_TRANSIT", version: 2 });
    } finally {
      spy.mockRestore();
    }
    expect(await stock(f.warehouse)).toBe(80000);
    expect(value(await exports.default.dispatchInventoryTransfer(request))).toMatchObject({
      status: "IN_TRANSIT",
      version: 2,
    });
  });
  it.each([
    ["inventory_transfer_line", "UPDATE"],
    ["inventory_balance", "INSERT"],
    ["inventory_transfer_receipt", "INSERT"],
    ["inventory_ledger_entries", "INSERT"],
    ["audit_event", "INSERT"],
    ["idempotency_records", "INSERT"],
  ])("rolls every receipt effect back when %s %s is skipped", async (table, event) => {
    const f = await fixture(),
      draft = await f.create(20000, f.second);
    value(await exports.default.dispatchInventoryTransfer(f.command(draft.transferId, 1)));
    const line = (await f.details(draft.transferId)).lines[0];
    if (!line) throw new Error("Missing line");
    const request = {
      ...f.command(draft.transferId, 2),
      lines: [{ lineId: line.lineId, acceptedBase: 10000 }],
    };
    await env.DB.prepare(
      `CREATE TRIGGER transfer_test_skip BEFORE ${event} ON ${table} BEGIN SELECT RAISE(IGNORE); END`,
    ).run();
    try {
      expect(await exports.default.receiveInventoryTransfer(request)).toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
      expect(await stock(f.second)).toBe(0);
      expect(await f.details(draft.transferId)).toMatchObject({
        status: "IN_TRANSIT",
        version: 2,
        receipts: [],
        lines: [{ acceptedBase: 0, outstandingBase: 20000 }],
      });
      expect(
        await env.DB.prepare("SELECT 1 FROM idempotency_records WHERE idempotency_key=?")
          .bind(request.idempotencyKey)
          .first(),
      ).toBeNull();
    } finally {
      await env.DB.prepare("DROP TRIGGER transfer_test_skip").run();
    }
  });
  it("rechecks authority inside the dispatch transaction", async () => {
    const f = await fixture(),
      draft = await f.create(),
      { headers: _headers, requestId, ...payload } = f.command(draft.transferId, 1);
    const batch = env.DB.batch.bind(env.DB);
    const spy = vi.spyOn(env.DB, "batch").mockImplementationOnce(async (statements) => {
      await env.DB.prepare("UPDATE staff_identity SET status='inactive' WHERE id=?")
        .bind(f.manager.id)
        .run();
      return batch(statements);
    });
    try {
      expect(
        await inventoryTransfers(env.DB, f.userId, requestId, Date.now()).dispatch(payload),
      ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    } finally {
      spy.mockRestore();
    }
    expect(await stock(f.warehouse)).toBe(100000);
    expect(
      await env.DB.prepare("SELECT status,version FROM inventory_transfer WHERE id=?")
        .bind(draft.transferId)
        .first(),
    ).toEqual({ status: "DRAFT", version: 1 });
  });
  it("protects reserved stock and refuses over-acceptance and stale receipts", async () => {
    const f = await fixture(),
      draft = await f.create(60000);
    await env.DB.prepare(
      "UPDATE inventory_balance SET reserved=50000 WHERE location_id=? AND inventory_pool_id=?",
    )
      .bind(f.warehouse, pool)
      .run();
    expect(
      await exports.default.dispatchInventoryTransfer(f.command(draft.transferId, 1)),
    ).toMatchObject({ ok: false, error: { code: "INSUFFICIENT_STOCK" } });
    await env.DB.prepare(
      "UPDATE inventory_balance SET reserved=0 WHERE location_id=? AND inventory_pool_id=?",
    )
      .bind(f.warehouse, pool)
      .run();
    value(await exports.default.dispatchInventoryTransfer(f.command(draft.transferId, 1)));
    const line = (await f.details(draft.transferId)).lines[0];
    if (!line) throw new Error("Missing line");
    expect(
      await exports.default.receiveInventoryTransfer({
        ...f.command(draft.transferId, 2),
        lines: [{ lineId: line.lineId, acceptedBase: 60001 }],
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(
      await exports.default.receiveInventoryTransfer({
        ...f.command(draft.transferId, 1),
        lines: [{ lineId: line.lineId, acceptedBase: 1 }],
      }),
    ).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
  });
  it.each(["inventory_transfer", "inventory_transfer_line", "audit_event", "idempotency_records"])(
    "rolls draft creation back when %s is skipped",
    async (table) => {
      const f = await fixture(),
        key = crypto.randomUUID();
      await env.DB.prepare(
        `CREATE TRIGGER transfer_test_skip BEFORE INSERT ON ${table} BEGIN SELECT RAISE(IGNORE); END`,
      ).run();
      try {
        expect(
          await exports.default.createInventoryTransfer({
            ...f.meta,
            sourceLocationId: f.warehouse,
            destinationLocationId: destination,
            reason: "Creation failure",
            idempotencyKey: key,
            lines: [{ inventoryPoolId: pool, quantityBase: 1000 }],
          }),
        ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
        expect(
          await env.DB.prepare("SELECT 1 FROM inventory_transfer WHERE source_location_id=?")
            .bind(f.warehouse)
            .first(),
        ).toBeNull();
        expect(
          await env.DB.prepare("SELECT 1 FROM idempotency_records WHERE idempotency_key=?")
            .bind(key)
            .first(),
        ).toBeNull();
        expect(
          await env.DB.prepare("SELECT 1 FROM audit_event WHERE idempotency_key=?")
            .bind(key)
            .first(),
        ).toBeNull();
      } finally {
        await env.DB.prepare("DROP TRIGGER transfer_test_skip").run();
      }
    },
  );
  it("allows only one competing accepted receipt for the same version", async () => {
    const f = await fixture(),
      draft = await f.create(20000, f.second);
    value(await exports.default.dispatchInventoryTransfer(f.command(draft.transferId, 1)));
    const line = (await f.details(draft.transferId)).lines[0];
    if (!line) throw new Error("Missing line");
    const results = await Promise.all(
      [1, 2].map(() =>
        exports.default.receiveInventoryTransfer({
          ...f.command(draft.transferId, 2),
          lines: [{ lineId: line.lineId, acceptedBase: 15000 }],
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await stock(f.second)).toBe(15000);
    expect(await f.details(draft.transferId)).toMatchObject({
      version: 3,
      status: "PARTIALLY_RECEIVED",
      lines: [{ acceptedBase: 15000, outstandingBase: 5000 }],
    });
  });
  it("protects a held quantity introduced between availability read and dispatch", async () => {
    const f = await fixture(),
      draft = await f.create(60000),
      id = crypto.randomUUID();
    // A retained HELD record remains protected until explicitly released, even past its expiry.
    // Warehouses cannot originate new customer checkout; reachable destination checkout concurrency is tested in instant-quote.integration.test.ts.
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',0,0)",
      ).bind(id, f.userId),
      env.DB.prepare(
        "INSERT INTO customer_address(id,customer_id,label,recipient,phone,address_json,latitude,longitude,status,created_at,updated_at) VALUES (?,?,'Fixture','Fixture','+639171110000','{}',10.3,123.9,'active',0,0)",
      ).bind(id, id),
      env.DB.prepare(
        "INSERT INTO cart(id,customer_id,location_id,status,created_at,updated_at) VALUES (?,?,?,'ACTIVE',0,0)",
      ).bind(id, id, f.warehouse),
      env.DB.prepare(
        "INSERT INTO checkout_attempts(id,customer_id,cart_id,address_id,cycle_id,fulfillment_mode,zone_id,location_id,status,idempotency_key,expires_at,created_at,updated_at) VALUES (?,?,?,?,NULL,'INSTANT','zone-cebu-city-core',?,'PROCESSING',?,1,0,0)",
      ).bind(id, id, id, id, f.warehouse, id),
    ]);
    const { headers: _headers, requestId, ...payload } = f.command(draft.transferId, 1),
      batch = env.DB.batch.bind(env.DB);
    const spy = vi.spyOn(env.DB, "batch").mockImplementationOnce(async (statements) => {
      await env.DB.prepare(
        "INSERT INTO checkout_inventory_holds(id,checkout_attempt_id,inventory_pool_id,location_id,quantity,status,created_at,updated_at) VALUES (?,?,?,?,50000,'HELD',0,0)",
      )
        .bind(id, id, pool, f.warehouse)
        .run();
      return batch(statements);
    });
    try {
      expect(
        await inventoryTransfers(env.DB, f.userId, requestId, Date.now()).dispatch(payload),
      ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    } finally {
      spy.mockRestore();
    }
    expect(await stock(f.warehouse)).toBe(100000);
    expect(await f.details(draft.transferId)).toMatchObject({ status: "DRAFT", version: 1 });
  });
  it("keeps GRAM and PIECE lines separate with distinct effects and destination-scoped acceptance", async () => {
    const f = await fixture();
    const piece = await env.DB.prepare(
      "SELECT pool.id FROM inventory_pool pool JOIN product p ON p.inventory_pool_id=pool.id JOIN unit u ON u.id=pool.base_unit_id WHERE u.canonical_base_code='PIECE' LIMIT 1",
    ).first<{ id: string }>();
    if (!piece) throw new Error("Missing PIECE fixture");
    value(
      await exports.default.adjustInventory({
        ...f.meta,
        locationId: f.warehouse,
        inventoryPoolId: piece.id,
        delta: 100,
        expectedVersion: 0,
        reason: "Opening pieces",
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    const draft = value(
      await exports.default.createInventoryTransfer({
        ...f.meta,
        sourceLocationId: f.warehouse,
        destinationLocationId: destination,
        reason: "Mixed base dimensions",
        idempotencyKey: crypto.randomUUID(),
        lines: [
          { inventoryPoolId: pool, quantityBase: 20000 },
          { inventoryPoolId: piece.id, quantityBase: 20 },
        ],
      }),
    );
    const dispatch = f.command(draft.transferId, 1);
    value(await exports.default.dispatchInventoryTransfer(dispatch));
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count,COUNT(DISTINCT idempotency_key) identities FROM inventory_ledger_entries WHERE reference_id=? AND movement_type='TRANSFER_DISPATCH'",
      )
        .bind(draft.transferId)
        .first(),
    ).toEqual({ count: 2, identities: 2 });
    const lines = (await f.details(draft.transferId)).lines;
    await env.DB.prepare(
      "UPDATE staff_scope SET scope_kind='location',location_id=? WHERE staff_id=?",
    )
      .bind(destination, f.manager.id)
      .run();
    expect((await f.details(draft.transferId)).allowedActions).toEqual(["RECEIVE"]);
    value(
      await exports.default.receiveInventoryTransfer({
        ...f.command(draft.transferId, 2),
        lines: lines.map((line) => ({ lineId: line.lineId, acceptedBase: line.quantityBase })),
      }),
    );
    expect(await f.details(draft.transferId)).toMatchObject({
      status: "RECEIVED",
      lines: expect.arrayContaining([
        expect.objectContaining({ baseUnit: "GRAM", acceptedBase: 20000 }),
        expect.objectContaining({ baseUnit: "PIECE", acceptedBase: 20 }),
      ]),
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count,COUNT(DISTINCT effect_key) identities FROM inventory_transfer_receipt WHERE transfer_id=?",
      )
        .bind(draft.transferId)
        .first(),
    ).toEqual({ count: 2, identities: 2 });
  });
  it("separates checked damage and shortage, then accounts for loss and a verified return", async () => {
    const f = await fixture(),
      draft = await f.create(20000, f.second);
    const distribution = async () =>
      value(
        await exports.default.listInventoryDistribution({
          ...f.meta,
          query: "Red onion",
          limit: 100,
        }),
      ).items.find((item) => item.inventoryPoolId === pool);
    const before = await distribution();
    if (!before) throw new Error("Missing distribution");
    value(await exports.default.dispatchInventoryTransfer(f.command(draft.transferId, 1)));
    const line = (await f.details(draft.transferId)).lines[0];
    if (!line) throw new Error("Missing line");
    const check = {
      ...f.command(draft.transferId, 2),
      lines: [{ lineId: line.lineId, acceptedBase: 15000, damagedBase: 3000, shortageBase: 2000 }],
    };
    const checked = await exports.default.receiveInventoryTransfer(check);
    expect(value(checked)).toMatchObject({ status: "PARTIALLY_RECEIVED", version: 3 });
    const during = await distribution();
    expect(during).toMatchObject({
      centralBase: before.centralBase - 20000,
      localBase: before.localBase + 15000,
      physicalBase: before.physicalBase - 5000,
      transitBase: before.transitBase + 5000,
      damagedBase: before.damagedBase + 3000,
      shortageBase: before.shortageBase + 2000,
    });
    const loss = {
      ...f.command(draft.transferId, 3),
      lineId: line.lineId,
      quantityBase: 2000,
      category: "MISSING" as const,
      outcome: "LOSS" as const,
    };
    expect(value(await exports.default.resolveInventoryTransfer(loss))).toMatchObject({
      version: 4,
      status: "PARTIALLY_RECEIVED",
    });
    const returned = {
      ...f.command(draft.transferId, 4),
      lineId: line.lineId,
      quantityBase: 3000,
      category: "DAMAGED" as const,
      outcome: "VERIFIED_RETURN" as const,
      inspectionConfirmed: true,
    };
    const resolved = await exports.default.resolveInventoryTransfer(returned);
    expect(value(resolved)).toMatchObject({ status: "RESOLVED", version: 5 });
    expect(await exports.default.resolveInventoryTransfer(returned)).toEqual(resolved);
    expect(await exports.default.receiveInventoryTransfer(check)).toEqual(checked);
    expect(await stock(f.warehouse)).toBe(83000);
    expect(await stock(f.second)).toBe(15000);
    expect(await f.details(draft.transferId)).toMatchObject({
      status: "RESOLVED",
      allowedActions: [],
      lines: [
        {
          acceptedBase: 15000,
          damagedBase: 0,
          shortageBase: 0,
          lostBase: 2000,
          returnedBase: 3000,
          outstandingBase: 0,
        },
      ],
    });
    expect(await distribution()).toMatchObject({
      centralBase: before.centralBase - 17000,
      localBase: before.localBase + 15000,
      physicalBase: before.physicalBase - 2000,
      transitBase: before.transitBase,
      damagedBase: before.damagedBase,
      shortageBase: before.shortageBase,
    });
    expect(
      await exports.default.resolveInventoryTransfer({ ...returned, quantityBase: 1 }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });
  it("records observations without stock credit and accepts recovered missing goods in a later check", async () => {
    const f = await fixture(),
      draft = await f.create(20000, f.second);
    value(await exports.default.dispatchInventoryTransfer(f.command(draft.transferId, 1)));
    const initial = await f.details(draft.transferId),
      line = initial.lines[0];
    if (!line) throw new Error("Missing line");
    expect(
      value(
        await exports.default.receiveInventoryTransfer({
          ...f.command(draft.transferId, 2),
          lines: [{ lineId: line.lineId, acceptedBase: 0, damagedBase: 4000, shortageBase: 16000 }],
        }),
      ),
    ).toMatchObject({ status: "IN_TRANSIT", version: 3 });
    expect(await stock(f.second)).toBe(0);
    expect(await f.details(draft.transferId)).toMatchObject({
      dispatchedAt: initial.dispatchedAt,
      receipts: [],
      checks: [{ acceptedBase: 0, damagedBase: 4000, shortageBase: 16000 }],
    });
    expect(
      await exports.default.receiveInventoryTransfer({
        ...f.command(draft.transferId, 3),
        lines: [{ lineId: line.lineId, acceptedBase: 1 }],
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    value(
      await exports.default.receiveInventoryTransfer({
        ...f.command(draft.transferId, 3),
        lines: [{ lineId: line.lineId, acceptedBase: 20000, damagedBase: 0, shortageBase: 0 }],
      }),
    );
    expect(await f.details(draft.transferId)).toMatchObject({
      status: "RECEIVED",
      lines: [
        { acceptedBase: 20000, damagedBase: 0, shortageBase: 0, lostBase: 0, returnedBase: 0 },
      ],
      resolutions: [],
    });
    expect(await stock(f.second)).toBe(20000);
    await expect(
      env.DB.prepare("UPDATE inventory_transfer_check SET damaged_base=0 WHERE transfer_id=?")
        .bind(draft.transferId)
        .run(),
    ).rejects.toThrow("immutable");
  });
  it("requires Global authority, current version, available category and verified sellable inspection", async () => {
    const f = await fixture(),
      draft = await f.create(20000, destination);
    value(await exports.default.dispatchInventoryTransfer(f.command(draft.transferId, 1)));
    const line = (await f.details(draft.transferId)).lines[0];
    if (!line) throw new Error("Missing line");
    const resolution = {
      ...f.command(draft.transferId, 2),
      lineId: line.lineId,
      quantityBase: 20000,
      category: "UNCLASSIFIED" as const,
      outcome: "VERIFIED_RETURN" as const,
    };
    expect(await exports.default.resolveInventoryTransfer(resolution)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
    expect(
      await exports.default.resolveInventoryTransfer({
        ...resolution,
        inspectionConfirmed: true,
        expectedVersion: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
    expect(
      await exports.default.resolveInventoryTransfer({
        ...resolution,
        inspectionConfirmed: true,
        category: "MISSING",
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    await env.DB.prepare(
      "UPDATE staff_scope SET scope_kind='location',location_id=? WHERE staff_id=?",
    )
      .bind(destination, f.manager.id)
      .run();
    expect(
      await exports.default.resolveInventoryTransfer({ ...resolution, inspectionConfirmed: true }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await exports.default.listInventoryDistribution(f.meta)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await stock(f.warehouse)).toBe(80000);
  });
  it.each([
    ["inventory_transfer", "UPDATE", "LOSS"],
    ["inventory_transfer_line", "UPDATE", "LOSS"],
    ["inventory_transfer_resolution", "INSERT", "LOSS"],
    ["audit_event", "INSERT", "LOSS"],
    ["idempotency_records", "INSERT", "LOSS"],
    ["inventory_balance", "INSERT", "VERIFIED_RETURN"],
    ["inventory_ledger_entries", "INSERT", "VERIFIED_RETURN"],
  ] as const)("rolls back %s %s failure during %s resolution", async (table, event, outcome) => {
    const f = await fixture(),
      draft = await f.create(20000, f.second);
    value(await exports.default.dispatchInventoryTransfer(f.command(draft.transferId, 1)));
    const line = (await f.details(draft.transferId)).lines[0];
    if (!line) throw new Error("Missing line");
    const request = {
      ...f.command(draft.transferId, 2),
      lineId: line.lineId,
      quantityBase: 20000,
      category: "UNCLASSIFIED" as const,
      outcome,
      inspectionConfirmed: true,
    };
    await env.DB.prepare(
      `CREATE TRIGGER transfer_test_skip BEFORE ${event} ON ${table} BEGIN SELECT RAISE(IGNORE); END`,
    ).run();
    try {
      expect(await exports.default.resolveInventoryTransfer(request)).toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
      expect(await stock(f.warehouse)).toBe(80000);
      expect(await f.details(draft.transferId)).toMatchObject({
        version: 2,
        status: "IN_TRANSIT",
        resolutions: [],
        lines: [{ lostBase: 0, returnedBase: 0, outstandingBase: 20000 }],
      });
      expect(
        await env.DB.prepare("SELECT 1 FROM idempotency_records WHERE idempotency_key=?")
          .bind(request.idempotencyKey)
          .first(),
      ).toBeNull();
    } finally {
      await env.DB.prepare("DROP TRIGGER transfer_test_skip").run();
    }
  });
  it("rolls acceptance back if its checking evidence is skipped", async () => {
    const f = await fixture(),
      draft = await f.create(20000, f.second);
    value(await exports.default.dispatchInventoryTransfer(f.command(draft.transferId, 1)));
    const line = (await f.details(draft.transferId)).lines[0];
    if (!line) throw new Error("Missing line");
    await env.DB.prepare(
      "CREATE TRIGGER transfer_test_skip BEFORE INSERT ON inventory_transfer_check BEGIN SELECT RAISE(IGNORE); END",
    ).run();
    try {
      expect(
        await exports.default.receiveInventoryTransfer({
          ...f.command(draft.transferId, 2),
          lines: [{ lineId: line.lineId, acceptedBase: 10000, damagedBase: 5000 }],
        }),
      ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(await stock(f.second)).toBe(0);
      expect(await f.details(draft.transferId)).toMatchObject({
        version: 2,
        status: "IN_TRANSIT",
        checks: [],
        receipts: [],
        lines: [{ acceptedBase: 0, damagedBase: 0 }],
      });
    } finally {
      await env.DB.prepare("DROP TRIGGER transfer_test_skip").run();
    }
  });
  it("allows only one competing full acceptance or physical return", async () => {
    const f = await fixture(),
      draft = await f.create(20000, f.second);
    value(await exports.default.dispatchInventoryTransfer(f.command(draft.transferId, 1)));
    const line = (await f.details(draft.transferId)).lines[0];
    if (!line) throw new Error("Missing line");
    const results = await Promise.all([
      exports.default.receiveInventoryTransfer({
        ...f.command(draft.transferId, 2),
        lines: [{ lineId: line.lineId, acceptedBase: 20000 }],
      }),
      exports.default.resolveInventoryTransfer({
        ...f.command(draft.transferId, 2),
        lineId: line.lineId,
        quantityBase: 20000,
        category: "UNCLASSIFIED",
        outcome: "VERIFIED_RETURN",
        inspectionConfirmed: true,
      }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect((await stock(f.warehouse)) + (await stock(f.second))).toBe(100000);
    expect((await f.details(draft.transferId)).lines[0]?.outstandingBase).toBe(0);
  });
});
