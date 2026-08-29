import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;

let counter = 0;

async function signUp(): Promise<{ cookie: string; userId: string }> {
  const n = ++counter;
  const email = `inv-admin-${n}-${crypto.randomUUID().slice(0, 12)}@example.com`;
  const password = "correct-horse-battery-staple";
  const signUpResponse = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Inventory Admin", email, password }),
  });
  expect(signUpResponse.status).toBeLessThan(400);
  const body = (await signUpResponse.json()) as { user?: { id?: string } };
  const userId = body.user!.id!;
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(userId).run();
  let cookie = (signUpResponse.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";", 1)[0])
    .join("; ");
  if (!cookie) {
    const signIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
      body: JSON.stringify({ email, password }),
    });
    cookie = (signIn.headers.getSetCookie?.() ?? []).map((c) => c.split(";", 1)[0]).join("; ");
  }
  return { cookie, userId };
}

async function seedStaff(options: {
  capabilities: string[];
  scope: "global" | "location";
}): Promise<{ cookie: string }> {
  const principal = await signUp();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const now = Date.now();
  const statements = [
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Inv Staff', 'active', ?, ?)",
    ).bind(staffId, principal.userId, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Inv Role', ?)",
    ).bind(roleId, `inv-${crypto.randomUUID().slice(0, 8)}`, now),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, ?, NULL, ?)",
    ).bind(
      crypto.randomUUID(),
      staffId,
      options.scope,
      options.scope === "location" ? "location-cebu-central" : null,
    ),
  ];
  for (const capability of options.capabilities) {
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'inv', ?)",
      ).bind(crypto.randomUUID(), capability, now),
    );
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code=?",
      ).bind(roleId, capability),
    );
  }
  await env.DB.batch(statements);
  return { cookie: principal.cookie };
}

/** One product with a gram pool and a balance row at Cebu Central. */
async function seedInventory(): Promise<{ productId: string; poolId: string }> {
  const now = Date.now();
  const categoryId = crypto.randomUUID();
  const poolId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const unitGramId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO category (id, code, name, slug, status, sort_order, created_at, updated_at) VALUES (?, ?, 'Inv Cat', ?, 'active', 60, ?, ?)",
    ).bind(
      categoryId,
      `IC_${crypto.randomUUID().slice(0, 12)}`,
      `inv-cat-${crypto.randomUUID().slice(0, 12)}`,
      now,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO unit (id, code, name, dimension, symbol, created_at) VALUES (?, ?, 'Gram', 'MASS', 'g', ?)",
    ).bind(unitGramId, `GRAM_I_${crypto.randomUUID().slice(0, 12)}`, now),
    env.DB.prepare(
      "INSERT INTO inventory_pool (id, product_id, base_unit_id, sourcing_mode, created_at, updated_at) VALUES (?, ?, ?, 'STOCKED', ?, ?)",
    ).bind(poolId, productId, unitGramId, now, now),
    env.DB.prepare(
      "INSERT INTO product (id, category_id, inventory_pool_id, slug, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
    ).bind(
      productId,
      categoryId,
      poolId,
      `inv-prod-${crypto.randomUUID().slice(0, 12)}`,
      `Inventory Product ${crypto.randomUUID().slice(0, 12)}`,
      now,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved) VALUES ('location-cebu-central', ?, 1000, 100)",
    ).bind(poolId),
  ]);
  return { productId, poolId };
}

describe("inventory administration reads", () => {
  it("denies unauthenticated, non-staff, and out-of-scope readers", async () => {
    expect(
      await core.listAdminInventory({
        requestId: "r1",
        headers: {},
        locationId: "location-cebu-central",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });

    const nonStaff = await signUp();
    expect(
      await core.listAdminInventory({
        requestId: crypto.randomUUID(),
        headers: { cookie: nonStaff.cookie },
        locationId: "location-cebu-central",
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    const locationScoped = await seedStaff({
      capabilities: ["inventory.read"],
      scope: "location",
    });
    // A location-scoped reader is denied on locations outside their scope.
    const otherLocation = await core.listAdminInventory({
      requestId: crypto.randomUUID(),
      headers: { cookie: locationScoped.cookie },
      locationId: "location-other-empty",
    });
    expect(otherLocation).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const otherLedger = await core.getAdminInventoryLedger({
      requestId: crypto.randomUUID(),
      headers: { cookie: locationScoped.cookie },
      locationId: "location-other-empty",
      inventoryPoolId: "pool-x",
    });
    expect(otherLedger).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("lists balances and the ledger after an audited adjustment", async () => {
    const manager = await seedStaff({
      capabilities: ["inventory.read", "inventory.adjust"],
      scope: "global",
    });
    const { poolId } = await seedInventory();

    const adjusted = await core.adjustInventory({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      locationId: "location-cebu-central",
      inventoryPoolId: poolId,
      delta: 500,
      reason: "cycle count top-up",
      idempotencyKey: `adj-${crypto.randomUUID()}`,
      expectedVersion: 1,
    });
    expect(adjusted.ok).toBe(true);

    const page = await core.listAdminInventory({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      locationId: "location-cebu-central",
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const item = page.value.items.find((entry) => entry.inventoryPoolId === poolId);
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      onHandBase: 1500,
      reservedBase: 100,
      baseUnitSymbol: "g",
      version: 2,
    });

    const ledger = await core.getAdminInventoryLedger({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      locationId: "location-cebu-central",
      inventoryPoolId: poolId,
    });
    expect(ledger.ok).toBe(true);
    if (!ledger.ok) return;
    expect(ledger.value.items.length).toBeGreaterThan(0);
    expect(ledger.value.items[0]).toMatchObject({
      quantityDeltaBase: 500,
      reasonCode: "cycle count top-up",
    });
  });
});
