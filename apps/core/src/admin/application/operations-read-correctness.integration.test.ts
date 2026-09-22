import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { Capability, CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;

async function signUp() {
  const email = `operations-read-${crypto.randomUUID().slice(0, 12)}@example.com`;
  const password = "correct-horse-battery-staple";
  const response = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Operations Reader", email, password }),
  });
  expect(response.status).toBeLessThan(400);
  const body = (await response.json()) as { user: { id: string } };
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(body.user.id).run();
  let cookie = (response.headers.getSetCookie?.() ?? [])
    .map((item) => item.split(";", 1)[0])
    .join("; ");
  if (!cookie) {
    const signIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
      body: JSON.stringify({ email, password }),
    });
    cookie = (signIn.headers.getSetCookie?.() ?? [])
      .map((item) => item.split(";", 1)[0])
      .join("; ");
  }
  return { cookie, userId: body.user.id };
}

async function seedLocation(prefix: string): Promise<string> {
  const locationId = `${prefix}-location`;
  await env.DB.prepare(
    "INSERT INTO fulfillment_location(id,market_id,code,name,type,latitude,longitude,status,created_at,updated_at) VALUES (?,'market-metro-cebu',?,?,'FULFILLMENT_CENTER',10,123,'active',1,1)",
  )
    .bind(locationId, locationId, `Operations ${prefix}`)
    .run();
  return locationId;
}

async function seedStaff(capabilities: ReadonlyArray<Capability>, locationId: string) {
  const principal = await signUp();
  const now = Date.now();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Operations Reader', 'active', ?, ?)",
    ).bind(staffId, principal.userId, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Operations', ?)",
    ).bind(roleId, `operations-${crypto.randomUUID().slice(0, 8)}`, now),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, 'location', NULL, ?)",
    ).bind(crypto.randomUUID(), staffId, locationId),
  ];
  for (const capability of capabilities) {
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'operations read', ?)",
      ).bind(crypto.randomUUID(), capability, now),
      env.DB.prepare(
        "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code=?",
      ).bind(roleId, capability),
    );
  }
  await env.DB.batch(statements);
  return principal.cookie;
}

async function seedCustomer(prefix: string) {
  const customerId = `${prefix}-customer`;
  await env.DB.prepare(
    "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
  )
    .bind(customerId, `${prefix}-auth`)
    .run();
  return customerId;
}

function orderStatements(input: {
  id: string;
  customerId: string;
  locationId: string;
  status: string;
  committedAt: number;
}): D1PreparedStatement[] {
  const paymentId = `${input.id}-payment`;
  return [
    env.DB.prepare(
      "INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,100,'PHP','SUCCEEDED','mock',?,1,1)",
    ).bind(paymentId, input.customerId, `${paymentId}-key`),
    env.DB.prepare(
      "INSERT INTO grocery_order(id,customer_id,cycle_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,created_at,committed_at,order_number) VALUES (?,?,NULL,'INSTANT','{}','COMMITTED',100,'PHP',?,?,?,?)",
    ).bind(
      input.id,
      input.customerId,
      paymentId,
      input.committedAt,
      input.committedAt,
      `FM-${input.id}`,
    ),
    env.DB.prepare(
      "INSERT INTO fulfillment_record(id,order_id,location_id,status,updated_at) VALUES (?,?,?,?,?)",
    ).bind(`${input.id}-fulfillment`, input.id, input.locationId, input.status, input.committedAt),
  ];
}

async function runBatches(statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }
}

describe("Admin operational read correctness", () => {
  it("filters fulfillment before pagination and binds cursors to the complete query", async () => {
    const prefix = `filter-${crypto.randomUUID()}`;
    const locationId = await seedLocation(prefix);
    const cookie = await seedStaff(["fulfillment.read"], locationId);
    const customerId = await seedCustomer(prefix);
    const now = Date.now();
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < 51; index += 1) {
      statements.push(
        ...orderStatements({
          id: `${prefix}-new-${index.toString().padStart(2, "0")}`,
          customerId,
          locationId,
          status: "NOT_STARTED",
          committedAt: now + index + 100,
        }),
      );
    }
    const preparingOrderIds = [`${prefix}-preparing-newer`, `${prefix}-preparing-older`];
    statements.push(
      ...orderStatements({
        id: preparingOrderIds[0],
        customerId,
        locationId,
        status: "PICKING",
        committedAt: now - 1,
      }),
      ...orderStatements({
        id: preparingOrderIds[1],
        customerId,
        locationId,
        status: "READY_TO_PACK",
        committedAt: now - 2,
      }),
    );
    await runBatches(statements);

    const request = {
      requestId: crypto.randomUUID(),
      headers: { cookie },
      locationId,
      filter: "PREPARING" as const,
    };
    const filtered = await core.listFulfillmentQueue({ ...request, limit: 50 });
    if (!filtered.ok) throw new Error(JSON.stringify(filtered.error));
    expect(filtered.value.items.map((item) => item.orderId)).toEqual(preparingOrderIds);
    expect(filtered.value.items.every((item) => item.operational?.progress === "PREPARING")).toBe(
      true,
    );

    const firstPage = await core.listFulfillmentQueue({ ...request, limit: 1 });
    if (!firstPage.ok) throw new Error(JSON.stringify(firstPage.error));
    expect(firstPage.value.nextCursor).not.toBeNull();
    expect(
      await core.listFulfillmentQueue({
        ...request,
        filter: "NEW",
        limit: 1,
        cursor: firstPage.value.nextCursor ?? undefined,
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("counts each open delivery job once and books only an active latest attempt", async () => {
    const prefix = `delivery-total-${crypto.randomUUID()}`;
    const locationId = await seedLocation(prefix);
    const cookie = await seedStaff(["delivery.read"], locationId);
    const customerId = await seedCustomer(prefix);
    const now = Date.now();
    const firstOrder = `${prefix}-order-1`;
    const secondOrder = `${prefix}-order-2`;
    await env.DB.batch([
      ...orderStatements({
        id: firstOrder,
        customerId,
        locationId,
        status: "PACKED",
        committedAt: now,
      }),
      ...orderStatements({
        id: secondOrder,
        customerId,
        locationId,
        status: "PACKED",
        committedAt: now - 1,
      }),
      env.DB.prepare(
        "INSERT INTO delivery_job(id,order_id,fulfillment_mode,location_id,zone_id,status,context_resolution_status,address_snapshot_json,version,created_at,updated_at) VALUES (?,?,'INSTANT',?,'zone-cebu-city-core','UNASSIGNED','RESOLVED','{}',1,?,?)",
      ).bind(`${prefix}-job-1`, firstOrder, locationId, now, now),
      env.DB.prepare(
        "INSERT INTO delivery_job(id,order_id,fulfillment_mode,location_id,zone_id,status,context_resolution_status,address_snapshot_json,version,created_at,updated_at) VALUES (?,?,'INSTANT',?,'zone-cebu-city-core','UNASSIGNED','RESOLVED','{}',1,?,?)",
      ).bind(`${prefix}-job-2`, secondOrder, locationId, now - 1, now - 1),
    ]);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO delivery_provider_dispatch(id,attempt_sequence,method,delivery_job_id,provider,merchant_order_id,request_hash,request_snapshot_json,status,version,created_at,updated_at) VALUES (?,1,'EXTERNAL',?,'lalamove',?,?,'{}','FAILED',1,?,?)",
      ).bind(
        `${prefix}-dispatch-1-failed`,
        `${prefix}-job-1`,
        `${prefix}-merchant-1-failed`,
        `${prefix}-hash-1-failed`,
        now - 2,
        now - 2,
      ),
      env.DB.prepare(
        "INSERT INTO delivery_provider_dispatch(id,attempt_sequence,method,delivery_job_id,provider,merchant_order_id,request_hash,request_snapshot_json,status,version,created_at,updated_at) VALUES (?,2,'EXTERNAL',?,'lalamove',?,?,'{}','ACTIVE',1,?,?)",
      ).bind(
        `${prefix}-dispatch-1-active`,
        `${prefix}-job-1`,
        `${prefix}-merchant-1-active`,
        `${prefix}-hash-1-active`,
        now - 1,
        now - 1,
      ),
      env.DB.prepare(
        "INSERT INTO delivery_provider_dispatch(id,attempt_sequence,method,delivery_job_id,provider,merchant_order_id,request_hash,request_snapshot_json,status,version,created_at,updated_at) VALUES (?,1,'EXTERNAL',?,'lalamove',?,?,'{}','FAILED',1,?,?)",
      ).bind(
        `${prefix}-dispatch-2-failed`,
        `${prefix}-job-2`,
        `${prefix}-merchant-2-failed`,
        `${prefix}-hash-2-failed`,
        now - 1,
        now - 1,
      ),
    ]);

    const result = await core.listDeliveryOperations({
      requestId: crypto.randomUUID(),
      headers: { cookie },
      locationId,
      limit: 50,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value).toMatchObject({ totalOpenJobs: 2, bookedJobs: 1, status: "OPEN" });
  });
});
