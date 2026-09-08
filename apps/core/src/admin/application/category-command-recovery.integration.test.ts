import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { createAuth } from "../../auth/service";
import { createAdminCategory } from "./catalog-commands";
import { requestHash } from "../../idempotency";

async function fixture() {
  const manager = await locationManager();
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('catalog.read','catalog.manage')",
  )
    .bind(manager.id)
    .run();
  const id = crypto.randomUUID();
  return {
    manager,
    request: {
      headers: manager.headers,
      requestId: id,
      idempotencyKey: id,
      code: `C_${id.replaceAll("-", "").toUpperCase()}`,
      name: "Fresh category",
      slug: `category-${id}`,
      sortOrder: 0,
      parentCategoryId: null,
      iconAssetKey: null,
    },
  };
}
async function expectUnapplied(key: string, code: string) {
  expect(
    await env.DB.prepare("SELECT count(*) count FROM category WHERE code=?").bind(code).first(),
  ).toEqual({ count: 0 });
  expect(
    await env.DB.prepare("SELECT count(*) count FROM audit_event WHERE idempotency_key=?")
      .bind(key)
      .first(),
  ).toEqual({ count: 0 });
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM idempotency_records WHERE scope='admin.catalog.category' AND idempotency_key=? AND status='SUCCEEDED'",
    )
      .bind(key)
      .first(),
  ).toEqual({ count: 0 });
}
describe("Category command recovery", () => {
  it("recovers an unapplied historical claim and admits concurrent same-key retries only once", async () => {
    const { request } = await fixture();
    const { code, name, slug, sortOrder, parentCategoryId, iconAssetKey } = request;
    const hash = await requestHash({ code, name, slug, sortOrder, parentCategoryId, iconAssetKey });
    await env.DB.prepare(
      "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,result_type,status,created_at,updated_at) VALUES ('admin.catalog.category',?,?,'admin.catalog.category','PROCESSING',1,1)",
    )
      .bind(request.idempotencyKey, hash)
      .run();
    const outcomes = await Promise.all([
      exports.default.createAdminCategory(request),
      exports.default.createAdminCategory(request),
    ]);
    expect(outcomes[0]).toMatchObject({ ok: true });
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(
      await env.DB.prepare("SELECT count(*) count FROM category WHERE code=?").bind(code).first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare("SELECT count(*) count FROM audit_event WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });
  it("validates raw command input before applying effects", async () => {
    expect(
      await createAdminCategory(
        { db: env.DB, auth: createAuth(env) },
        { name: 3, requestId: "invalid-category" },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED", requestId: "invalid-category" },
    });
  });
  for (const effect of ["category", "audit", "receipt"] as const) {
    it(`rejects suppressed ${effect} with no partial category or success`, async () => {
      const { request } = await fixture();
      const trigger =
        effect === "category"
          ? "BEFORE INSERT ON category"
          : effect === "audit"
            ? "BEFORE INSERT ON audit_event WHEN NEW.action='CATALOG.CATEGORY_CREATED'"
            : "BEFORE UPDATE ON idempotency_records WHEN NEW.scope='admin.catalog.category' AND NEW.status='SUCCEEDED'";
      await env.DB.exec(
        `CREATE TRIGGER suppress_category_effect ${trigger} BEGIN SELECT RAISE(IGNORE); END;`,
      );
      try {
        expect(await exports.default.createAdminCategory(request)).toMatchObject({ ok: false });
        await expectUnapplied(request.idempotencyKey, request.code);
      } finally {
        await env.DB.exec("DROP TRIGGER suppress_category_effect");
      }
      expect(await exports.default.createAdminCategory(request)).toMatchObject({ ok: true });
    });
  }
  it("rejects authority revoked after the initial access read", async () => {
    const { manager, request } = await fixture();
    let revoke = true;
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            if (revoke) {
              revoke = false;
              await target
                .prepare("DELETE FROM staff_scope WHERE staff_id=?")
                .bind(manager.id)
                .run();
            }
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await createAdminCategory({ db, auth: createAuth(env) }, request)).toMatchObject({
      ok: false,
    });
    expect(revoke).toBe(false);
    await expectUnapplied(request.idempotencyKey, request.code);
  });
  it("recovers the committed receipt when the batch response is lost", async () => {
    const { request } = await fixture();
    let lose = true;
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            const result = await target.batch(statements);
            if (lose) {
              lose = false;
              throw new Error("Simulated lost batch response");
            }
            return result;
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const created = await createAdminCategory({ db, auth: createAuth(env) }, request);
    expect(created).toMatchObject({ ok: true });
    expect(await exports.default.createAdminCategory(request)).toEqual(created);
  });
  it("returns frozen create, edit and lifecycle results after later mutations", async () => {
    const { request } = await fixture();
    const created = await exports.default.createAdminCategory(request);
    if (!created.ok) throw new Error(created.error.message);
    const edit = {
      ...request,
      categoryId: created.value.categoryId,
      expectedVersion: 1,
      name: "Edited category",
      idempotencyKey: crypto.randomUUID(),
    };
    const edited = await exports.default.updateAdminCategory(edit);
    expect(edited).toMatchObject({ ok: true, value: { name: "Edited category", version: 2 } });
    const deactivate = {
      ...request,
      categoryId: created.value.categoryId,
      expectedVersion: 2,
      status: "inactive" as const,
      reason: "Season ended",
      idempotencyKey: crypto.randomUUID(),
    };
    const deactivated = await exports.default.setAdminCategoryStatus(deactivate);
    expect(deactivated).toMatchObject({ ok: true, value: { status: "inactive", version: 3 } });
    expect(
      await exports.default.setAdminCategoryStatus({
        ...deactivate,
        status: "active",
        expectedVersion: 3,
        idempotencyKey: crypto.randomUUID(),
        reason: "Season resumed",
      }),
    ).toMatchObject({ ok: true });
    expect(await exports.default.createAdminCategory(request)).toEqual(created);
    expect(await exports.default.updateAdminCategory(edit)).toEqual(edited);
    expect(await exports.default.setAdminCategoryStatus(deactivate)).toEqual(deactivated);
    expect(
      await exports.default.updateAdminCategory({ ...edit, name: "Changed replay" }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });
  it("allows only one of two category edits that would jointly create a hierarchy cycle", async () => {
    const { request } = await fixture();
    const first = await exports.default.createAdminCategory(request);
    const second = await exports.default.createAdminCategory({
      ...request,
      code: `${request.code}B`,
      slug: `${request.slug}-b`,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!first.ok || !second.ok) throw new Error("Category setup failed");
    const commands = [
      {
        ...request,
        categoryId: first.value.categoryId,
        parentCategoryId: second.value.categoryId,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      },
      {
        ...request,
        code: `${request.code}B`,
        slug: `${request.slug}-b`,
        categoryId: second.value.categoryId,
        parentCategoryId: first.value.categoryId,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      },
    ];
    const outcomes = await Promise.all(
      commands.map((command) => exports.default.updateAdminCategory(command)),
    );
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare(
        "SELECT count(*) count FROM audit_event WHERE action='CATALOG.CATEGORY_UPDATED' AND idempotency_key IN (?,?)",
      )
        .bind(commands[0].idempotencyKey, commands[1].idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });
});
