import { describe, it, expect } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { createAuth } from "../../auth/service";
import { cleanProductMedia } from "./product-media-recovery";
import { uploadAdminProductMedia } from "./product-media";
import { productMediaCleanupJob } from "../../scheduling/jobs/product-media-cleanup";
import { runRegisteredJobs } from "../../scheduling/run-scheduled-jobs";
import { auditEventStatement } from "../../audit/application/append-audit-event";
async function fixture() {
  const manager = await locationManager();
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('catalog.read','catalog.manage')",
  )
    .bind(manager.id)
    .run();
  const product = await env.DB.prepare(
    "SELECT p.id,p.version FROM product p JOIN sku s ON s.product_id=p.id WHERE s.id='sku-red-onion-500g'",
  ).first<{ id: string; version: number }>();
  if (!product) throw new Error("Missing catalog fixture");
  return {
    manager,
    request: {
      headers: manager.headers,
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      productId: product.id,
      expectedProductVersion: product.version,
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]).buffer,
      mimeType: "image/jpeg" as const,
      altText: "Fresh onions",
      isPrimary: true,
      sortOrder: 0,
    },
  };
}
describe("Product media durable recovery", () => {
  it("replays a retained identity-only upload receipt from its minimal historical audit", async () => {
    const { manager, request } = await fixture();
    const uploaded = await exports.default.uploadAdminProductMedia(request);
    if (!uploaded.ok) throw new Error(uploaded.error.message);
    const historicalKey = crypto.randomUUID();
    const actor = await env.DB.prepare("SELECT auth_user_id FROM staff_identity WHERE id=?")
      .bind(manager.id)
      .first<string>("auth_user_id");
    if (!actor) throw new Error("Missing authenticated staff identity");
    const now = Date.now();
    // Compatibility fixture reproduces the pre-0084 receipt and audit shapes.
    // Its current attachment is then edited through the reachable command.
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,result_type,status,result_reference,created_at,updated_at)
        SELECT scope,?,request_hash,result_type,'SUCCEEDED',?,?,? FROM idempotency_records WHERE scope='admin.catalog.product-media.upload' AND idempotency_key=?`).bind(
        historicalKey,
        uploaded.value.mediaId,
        now,
        now,
        request.idempotencyKey,
      ),
      auditEventStatement(env.DB, {
        actorUserId: actor,
        action: "CATALOG.PRODUCT_MEDIA_UPLOADED",
        resourceType: "product_media",
        resourceId: uploaded.value.mediaId,
        details: {
          productId: request.productId,
          mimeType: request.mimeType,
          byteSize: request.bytes.byteLength,
          altText: request.altText,
          isPrimary: request.isPrimary,
          sortOrder: request.sortOrder,
          expectedProductVersion: request.expectedProductVersion,
        },
        after: { status: "active", version: 1 },
        idempotencyKey: historicalKey,
        correlationId: request.requestId,
        occurredAt: now,
      }),
    ]);
    expect(
      await exports.default.updateAdminProductMedia({
        ...request,
        mediaId: uploaded.value.mediaId,
        expectedProductVersion: request.expectedProductVersion + 1,
        altText: "Later caption",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(
      await exports.default.uploadAdminProductMedia({ ...request, idempotencyKey: historicalKey }),
    ).toEqual(uploaded);
  });
  it("bounds failed background cleanup attempts without restoring removed publication", async () => {
    const { request } = await fixture();
    const uploaded = await exports.default.uploadAdminProductMedia(request);
    if (!uploaded.ok) throw new Error(uploaded.error.message);
    expect(
      await exports.default.removeAdminProductMedia({
        ...request,
        mediaId: uploaded.value.mediaId,
        expectedProductVersion: request.expectedProductVersion + 1,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    const cleanup = await env.DB.prepare(
      "SELECT c.id,c.object_key FROM product_media_cleanup c JOIN product_media m ON m.object_key=c.object_key WHERE m.id=?",
    )
      .bind(uploaded.value.mediaId)
      .first<{ id: string; object_key: string }>();
    if (!cleanup) throw new Error("Missing cleanup intent");
    let attempts = 0;
    const failingBucket = new Proxy(env.PRODUCT_MEDIA, {
      get(target, property) {
        if (property === "delete")
          return async (key: string) => {
            if (key !== cleanup.object_key) return target.delete(key);
            attempts++;
            throw new Error("Simulated unavailable deletion");
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const now = Date.now();
    for (let index = 0; index < 6; index++)
      await runRegisteredJobs(
        env.DB,
        "*/15 * * * *",
        now + index * 3600000,
        [productMediaCleanupJob],
        undefined,
        undefined,
        undefined,
        undefined,
        failingBucket,
      );
    expect(attempts).toBe(5);
    const failed = await env.DB.prepare(
      "SELECT status,version,attempt_count FROM product_media_cleanup WHERE id=?",
    )
      .bind(cleanup.id)
      .first<{ status: string; version: number; attempt_count: number }>();
    expect(failed).toMatchObject({ status: "FAILED", attempt_count: 5 });
    expect(
      await exports.default.getPublishedProductMedia({
        requestId: request.requestId,
        mediaId: uploaded.value.mediaId,
        version: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
  it("recovers a lost successful D1 publication response without deleting its object", async () => {
    const { request } = await fixture();
    let batches = 0;
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            const result = await target.batch(statements);
            if (++batches === 2) throw new Error("Simulated lost committed D1 response");
            return result;
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await uploadAdminProductMedia(
      { db, auth: createAuth(env), bucket: env.PRODUCT_MEDIA },
      request,
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error.message);
    expect(
      await exports.default.getPublishedProductMedia({
        requestId: request.requestId,
        mediaId: result.value.mediaId,
        version: 1,
      }),
    ).toMatchObject({ ok: true });
    expect(await exports.default.uploadAdminProductMedia(request)).toEqual(result);
    expect(
      await env.DB.prepare("SELECT status FROM product_media_upload WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ status: "ATTACHED" });
  });
  it.each([
    ["product", "BEFORE UPDATE ON product", "NEW.version=OLD.version+1"],
    ["attachment", "BEFORE INSERT ON product_media", "1=1"],
    ["upload", "BEFORE UPDATE ON product_media_upload", "NEW.status='ATTACHED'"],
    [
      "receipt",
      "BEFORE UPDATE ON idempotency_records",
      "NEW.scope='admin.catalog.product-media.upload' AND NEW.status='SUCCEEDED'",
    ],
  ])(
    "rolls back publication when the required %s effect is suppressed",
    async (_name, operation, condition) => {
      const { request } = await fixture();
      await env.DB.exec(
        `CREATE TRIGGER suppress_media_effect ${operation} WHEN ${condition} BEGIN SELECT RAISE(IGNORE); END;`,
      );
      try {
        expect(await exports.default.uploadAdminProductMedia(request)).toMatchObject({ ok: false });
        expect(
          await env.DB.prepare("SELECT version FROM product WHERE id=?")
            .bind(request.productId)
            .first(),
        ).toEqual({ version: request.expectedProductVersion });
        expect(
          await env.DB.prepare(
            "SELECT count(*) count FROM audit_event WHERE action='CATALOG.PRODUCT_MEDIA_UPLOADED' AND idempotency_key=?",
          )
            .bind(request.idempotencyKey)
            .first(),
        ).toEqual({ count: 0 });
        expect(
          await env.DB.prepare(
            "SELECT status FROM idempotency_records WHERE scope='admin.catalog.product-media.upload' AND idempotency_key=?",
          )
            .bind(request.idempotencyKey)
            .first(),
        ).toEqual({ status: "PROCESSING" });
      } finally {
        await env.DB.exec("DROP TRIGGER suppress_media_effect");
      }
      expect(await exports.default.uploadAdminProductMedia(request)).toMatchObject({ ok: true });
    },
  );
  it("serializes competing upload publications and preserves the winning object", async () => {
    const { request } = await fixture();
    const competing = {
      ...request,
      idempotencyKey: crypto.randomUUID(),
      altText: "Competing image",
    };
    const results = await Promise.all([
      exports.default.uploadAdminProductMedia(request),
      exports.default.uploadAdminProductMedia(competing),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const winnerIndex = results.findIndex((result) => result.ok);
    const winningRequest = winnerIndex === 0 ? request : competing;
    const winner = results[winnerIndex];
    if (!winner.ok) throw new Error("Missing winner");
    expect(await exports.default.uploadAdminProductMedia(winningRequest)).toEqual(winner);
    expect(
      await env.DB.prepare(
        "SELECT count(*) count FROM audit_event WHERE action='CATALOG.PRODUCT_MEDIA_UPLOADED' AND idempotency_key IN (?,?)",
      )
        .bind(request.idempotencyKey, competing.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await exports.default.getPublishedProductMedia({
        requestId: request.requestId,
        mediaId: winner.value.mediaId,
        version: 1,
      }),
    ).toMatchObject({ ok: true });
  });
  it("recovers an absent unknown write with create-only retry of the original immutable object", async () => {
    const { request } = await fixture();
    const keys: string[] = [];
    const bucket = new Proxy(env.PRODUCT_MEDIA, {
      get(target, property) {
        if (property === "put")
          return async (...args: Parameters<R2Bucket["put"]>) => {
            keys.push(args[0]);
            expect(args[2]?.onlyIf).toEqual({ etagDoesNotMatch: "*" });
            if (keys.length === 1) throw new Error("Simulated unknown write");
            return target.put(...args);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const deps = { db: env.DB, auth: createAuth(env), bucket };
    expect(await uploadAdminProductMedia(deps, request)).toMatchObject({ ok: false });
    expect(await uploadAdminProductMedia(deps, request)).toMatchObject({ ok: true });
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(
      await env.DB.prepare("SELECT status FROM product_media_upload WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ status: "ATTACHED" });
    expect(
      await env.DB.prepare("SELECT count(*) count FROM product_media WHERE object_key=?")
        .bind(keys[0])
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare(
        "SELECT status FROM idempotency_records WHERE scope='admin.catalog.product-media.upload' AND idempotency_key=?",
      )
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ status: "SUCCEEDED" });
  });
  it("serves only the current published image anonymously and projects its versioned URL", async () => {
    const { request } = await fixture();
    const uploaded = await exports.default.uploadAdminProductMedia(request);
    if (!uploaded.ok) throw new Error(uploaded.error.message);
    const imageRequest = {
      requestId: crypto.randomUUID(),
      mediaId: uploaded.value.mediaId,
      version: 1,
    };
    const image = await exports.default.getPublishedProductMedia(imageRequest);
    expect(image).toMatchObject({ ok: true, value: { mimeType: "image/jpeg" } });
    if (image.ok) expect(new Uint8Array(image.value.bytes)).toEqual(new Uint8Array(request.bytes));
    const cart = await exports.default.getCart(request);
    if (!cart.ok) throw new Error(cart.error.message);
    const added = await exports.default.setCartItem({
      ...request,
      cartId: cart.value.id,
      skuId: "sku-red-onion-500g",
      quantity: 1,
      expectedVersion: cart.value.version,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(added).toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({
            media: { src: `/media/products/${uploaded.value.mediaId}/1`, alt: request.altText },
          }),
        ],
      },
    });
    const product = await env.DB.prepare("SELECT slug FROM product WHERE id=?")
      .bind(request.productId)
      .first<{ slug: string }>();
    if (!product) throw new Error("Missing product");
    expect(
      await exports.default.getCatalogProduct({
        requestId: crypto.randomUUID(),
        slug: product.slug,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        product: {
          media: { src: `/media/products/${uploaded.value.mediaId}/1`, alt: request.altText },
        },
      },
    });
    expect(
      await exports.default.getPublishedProductMedia({ ...imageRequest, version: 2 }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      await exports.default.removeAdminProductMedia({
        ...request,
        mediaId: uploaded.value.mediaId,
        expectedProductVersion: request.expectedProductVersion + 1,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(await exports.default.getPublishedProductMedia(imageRequest)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    const afterRemoval = await exports.default.getCatalogProduct({
      requestId: crypto.randomUUID(),
      slug: product.slug,
    });
    expect(afterRemoval).toMatchObject({ ok: true });
    if (afterRemoval.ok)
      expect(afterRemoval.value?.product.media?.src).not.toBe(
        `/media/products/${uploaded.value.mediaId}/1`,
      );
  });
  it("recovers an accepted R2 write with a lost response without writing another object", async () => {
    const { request } = await fixture();
    let writes = 0;
    const bucket = new Proxy(env.PRODUCT_MEDIA, {
      get(target, property) {
        if (property === "put")
          return async (...args: Parameters<R2Bucket["put"]>) => {
            writes++;
            await target.put(...args);
            throw new Error("Simulated lost storage response");
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const deps = { db: env.DB, auth: createAuth(env), bucket };
    expect(await uploadAdminProductMedia(deps, request)).toMatchObject({ ok: false });
    expect(
      await env.DB.prepare("SELECT status FROM product_media_upload WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ status: "UNKNOWN" });
    expect(
      await uploadAdminProductMedia(deps, { ...request, altText: "Changed intent" }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    const recovered = await uploadAdminProductMedia(deps, request);
    expect(recovered).toMatchObject({ ok: true });
    expect(writes).toBe(1);
    expect(await uploadAdminProductMedia(deps, request)).toEqual(recovered);
    expect(
      await env.DB.prepare(
        "SELECT count(*) count FROM product_media_upload WHERE idempotency_key=?",
      )
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });
  it("removes publication atomically and retries a failed object deletion through the scheduler", async () => {
    const { request } = await fixture();
    const uploaded = await exports.default.uploadAdminProductMedia(request);
    if (!uploaded.ok) throw new Error(uploaded.error.message);
    const removal = {
      ...request,
      mediaId: uploaded.value.mediaId,
      expectedProductVersion: request.expectedProductVersion + 1,
      idempotencyKey: crypto.randomUUID(),
    };
    const removed = await exports.default.removeAdminProductMedia(removal);
    expect(removed).toMatchObject({ ok: true, value: { status: "inactive" } });
    const intent = await env.DB.prepare(
      "SELECT c.object_key FROM product_media_cleanup c JOIN product_media m ON m.object_key=c.object_key WHERE m.id=?",
    )
      .bind(uploaded.value.mediaId)
      .first<{ object_key: string }>();
    if (!intent) throw new Error("Missing durable cleanup intent");
    expect(await env.PRODUCT_MEDIA.head(intent.object_key)).not.toBeNull();
    let deletes = 0;
    const bucket = new Proxy(env.PRODUCT_MEDIA, {
      get(target, property) {
        if (property === "delete")
          return async (key: string) => {
            if (key !== intent.object_key) return target.delete(key);
            deletes++;
            if (deletes === 1) throw new Error("Simulated unavailable storage");
            await target.delete(key);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const now = Date.now();
    const run = (time: number) =>
      runRegisteredJobs(
        env.DB,
        "*/15 * * * *",
        time,
        [productMediaCleanupJob],
        undefined,
        undefined,
        undefined,
        undefined,
        bucket,
      );
    await run(now);
    expect(
      await env.DB.prepare(
        "SELECT status,attempt_count FROM product_media_cleanup WHERE object_key=?",
      )
        .bind(intent.object_key)
        .first(),
    ).toEqual({ status: "PENDING", attempt_count: 1 });
    await run(now + 1);
    expect(deletes).toBe(1);
    await run(now + 120000);
    expect(await env.PRODUCT_MEDIA.head(intent.object_key)).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT status,attempt_count FROM product_media_cleanup WHERE object_key=?",
      )
        .bind(intent.object_key)
        .first(),
    ).toEqual({ status: "SUCCEEDED", attempt_count: 2 });
    expect(await exports.default.removeAdminProductMedia(removal)).toEqual(removed);
    await run(now + 240000);
    expect(deletes).toBe(2);
  });
  it("does not attach media or report success when required audit is suppressed", async () => {
    const { request } = await fixture();
    await env.DB.exec(
      "CREATE TRIGGER ignore_media_audit BEFORE INSERT ON audit_event WHEN NEW.action='CATALOG.PRODUCT_MEDIA_UPLOADED' BEGIN SELECT RAISE(IGNORE); END;",
    );
    try {
      expect(await exports.default.uploadAdminProductMedia(request)).toMatchObject({ ok: false });
      expect(
        await env.DB.prepare("SELECT version FROM product WHERE id=?")
          .bind(request.productId)
          .first(),
      ).toEqual({ version: request.expectedProductVersion });
      expect(
        await env.DB.prepare(
          "SELECT count(*) count FROM idempotency_records WHERE idempotency_key=? AND status='SUCCEEDED'",
        )
          .bind(request.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_media_audit");
    }
    expect(await exports.default.uploadAdminProductMedia(request)).toMatchObject({ ok: true });
  });
  it("rechecks Global authority after object storage and before publication", async () => {
    const { manager, request } = await fixture();
    const bucket = new Proxy(env.PRODUCT_MEDIA, {
      get(target, property) {
        if (property === "put")
          return async (...args: Parameters<R2Bucket["put"]>) => {
            const stored = await target.put(...args);
            await env.DB.prepare("DELETE FROM staff_scope WHERE staff_id=?").bind(manager.id).run();
            return stored;
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(
      await uploadAdminProductMedia({ db: env.DB, auth: createAuth(env), bucket }, request),
    ).toMatchObject({ ok: false });
    expect(
      await env.DB.prepare("SELECT version FROM product WHERE id=?")
        .bind(request.productId)
        .first(),
    ).toEqual({ version: request.expectedProductVersion });
    expect(
      await env.DB.prepare(
        "SELECT count(*) count FROM idempotency_records WHERE idempotency_key=? AND status='SUCCEEDED'",
      )
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 0 });
    expect(await cleanProductMedia(env.DB, env.PRODUCT_MEDIA, Date.now() + 86400001)).toBe(1);
    const expired = await env.DB.prepare(
      "SELECT status,object_key FROM product_media_upload WHERE idempotency_key=?",
    )
      .bind(request.idempotencyKey)
      .first<{ status: string; object_key: string }>();
    expect(expired?.status).toBe("ABANDONED");
    if (!expired) throw new Error("Missing upload evidence");
    expect(await env.PRODUCT_MEDIA.head(expired.object_key)).toBeNull();
  });
  it("returns the original upload receipt after later metadata edits", async () => {
    const { request } = await fixture();
    const uploaded = await exports.default.uploadAdminProductMedia(request);
    if (!uploaded.ok) throw new Error(uploaded.error.message);
    expect(
      await exports.default.updateAdminProductMedia({
        ...request,
        mediaId: uploaded.value.mediaId,
        expectedProductVersion: request.expectedProductVersion + 1,
        altText: "Updated caption",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(await exports.default.uploadAdminProductMedia(request)).toEqual(uploaded);
  });
});
