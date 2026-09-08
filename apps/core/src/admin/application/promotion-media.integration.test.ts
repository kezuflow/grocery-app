import { describe, expect, it, vi } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { createAuth } from "../../auth/service";
import { uploadAdminPromotionMedia } from "./promotion-media";
import { cleanPromotionMedia } from "./promotion-media-storage";
import { getPublishedPromotionMedia } from "./promotion-media-reads";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]).buffer;
async function fixture() {
  const manager = await locationManager();
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('promotions.read','promotions.manage')",
  )
    .bind(manager.id)
    .run();
  const meta = {
    headers: manager.headers,
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  };
  const created = await exports.default.createAdminPromotion({
    ...meta,
    code: `MEDIA_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`,
    name: "Fresh campaign",
    description: "Fresh produce savings",
    benefitType: "ORDER_FIXED_DISCOUNT",
    discountMinor: 500,
    minimumMinor: 0,
    startsAt: new Date(Date.now() - 10000).toISOString(),
  });
  if (!created.ok) throw new Error(created.error.message);
  const request = {
    ...meta,
    idempotencyKey: crypto.randomUUID(),
    promotionId: created.value.promotionId,
    expectedMedia: null,
    altText: "Fresh vegetables",
    bytes: png,
    mimeType: "image/png" as const,
  };
  return { manager, request };
}
describe("Campaign media through Core RPC and Worker D1/R2", () => {
  it("publishes at the opening instant and closes strictly at the end instant", async () => {
    const { request } = await fixture();
    const uploaded = await exports.default.uploadAdminPromotionMedia(request);
    if (!uploaded.ok) throw new Error(uploaded.error.message);
    await exports.default.changeAdminPromotionStatus({
      ...request,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 1,
      action: "ACTIVATE",
      reason: "Publish",
    });
    // Boundary fixture changes time only; the campaign and attachment are reached through commands.
    await env.DB.prepare("UPDATE promotion SET starts_at=1000,ends_at=2000 WHERE id=?")
      .bind(request.promotionId)
      .run();
    const clock = vi.spyOn(Date, "now");
    try {
      for (const [at, published] of [
        [999, false],
        [1000, true],
        [1999, true],
        [2000, false],
      ] as const) {
        clock.mockReturnValue(at);
        expect(
          (
            await getPublishedPromotionMedia(env.DB, env.PRODUCT_MEDIA, {
              requestId: request.requestId,
              mediaId: uploaded.value.mediaId,
              version: 1,
            })
          ).ok,
        ).toBe(published);
      }
    } finally {
      clock.mockRestore();
    }
  });
  it("observes an abandoned unknown upload before expiring and cleaning confirmed storage", async () => {
    const { request } = await fixture();
    const put = env.PRODUCT_MEDIA.put.bind(env.PRODUCT_MEDIA);
    const spy = vi.spyOn(env.PRODUCT_MEDIA, "put").mockImplementationOnce(async (...args) => {
      await put(...args);
      throw new Error("Lost response");
    });
    try {
      expect(
        await uploadAdminPromotionMedia(
          { db: env.DB, bucket: env.PRODUCT_MEDIA, auth: createAuth(env) },
          request,
        ),
      ).toMatchObject({ ok: false });
    } finally {
      spy.mockRestore();
    }
    const tomorrow = Date.now() + 86400001;
    expect(await cleanPromotionMedia(env.DB, env.PRODUCT_MEDIA, tomorrow)).toBe(0);
    expect(
      await env.DB.prepare("SELECT status FROM promotion_media_upload WHERE promotion_id=?")
        .bind(request.promotionId)
        .first(),
    ).toEqual({ status: "STORED" });
    expect(await cleanPromotionMedia(env.DB, env.PRODUCT_MEDIA, tomorrow + 86400001)).toBe(1);
    expect(await exports.default.getAdminPromotionMedia(request)).toMatchObject({
      ok: true,
      value: null,
    });
  });
  it("invalidates public content after caption changes and deactivation", async () => {
    const { request } = await fixture();
    const uploaded = await exports.default.uploadAdminPromotionMedia(request);
    if (!uploaded.ok) throw new Error(uploaded.error.message);
    const mediaId = uploaded.value.mediaId;
    await exports.default.changeAdminPromotionStatus({
      ...request,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 1,
      action: "ACTIVATE",
      reason: "Publish",
    });
    const updated = await exports.default.updateAdminPromotionMedia({
      ...request,
      idempotencyKey: crypto.randomUUID(),
      mediaId,
      expectedVersion: 1,
      altText: "New caption",
    });
    expect(updated).toMatchObject({ ok: true, value: { version: 2 } });
    expect(
      await exports.default.getPublishedPromotionMedia({
        requestId: request.requestId,
        mediaId,
        version: 1,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await exports.default.getPublishedPromotionMedia({
        requestId: request.requestId,
        mediaId,
        version: 2,
      }),
    ).toMatchObject({ ok: true });
    await exports.default.changeAdminPromotionStatus({
      ...request,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 2,
      action: "DEACTIVATE",
      reason: "Stop publication",
    });
    expect(
      await exports.default.getPublishedPromotionMedia({
        requestId: request.requestId,
        mediaId,
        version: 2,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await exports.default.getAdminPromotionMediaContent({ ...request, mediaId }),
    ).toMatchObject({ ok: true });
  });
  it("keeps a revoked upload unpublished and expires its confirmed object internally", async () => {
    const { request, manager } = await fixture();
    const put = env.PRODUCT_MEDIA.put.bind(env.PRODUCT_MEDIA);
    const spy = vi.spyOn(env.PRODUCT_MEDIA, "put").mockImplementationOnce(async (...args) => {
      const object = await put(...args);
      await env.DB.prepare(
        "DELETE FROM role_permission WHERE role_id=? AND permission_id=(SELECT id FROM permission WHERE code='promotions.manage')",
      )
        .bind(manager.id)
        .run();
      return object;
    });
    try {
      expect(
        await uploadAdminPromotionMedia(
          { db: env.DB, bucket: env.PRODUCT_MEDIA, auth: createAuth(env) },
          request,
        ),
      ).toMatchObject({ ok: false });
    } finally {
      spy.mockRestore();
    }
    expect(await exports.default.getAdminPromotionMedia(request)).toMatchObject({
      ok: true,
      value: null,
    });
    expect(await cleanPromotionMedia(env.DB, env.PRODUCT_MEDIA, Date.now() + 86400001)).toBe(1);
    expect(
      (await env.PRODUCT_MEDIA.list({ prefix: `promotions/${request.promotionId}/` })).objects,
    ).toHaveLength(0);
    expect(
      await env.DB.prepare(
        "SELECT status FROM idempotency_records WHERE scope='admin.promotions.media.upload' AND idempotency_key=?",
      )
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ status: "PROCESSING" });
  });
  it("retries failed cleanup internally without deleting active content", async () => {
    const { request } = await fixture();
    const uploaded = await exports.default.uploadAdminPromotionMedia(request);
    if (!uploaded.ok) throw new Error(uploaded.error.message);
    expect(await cleanPromotionMedia(env.DB, env.PRODUCT_MEDIA, Date.now() + 86400001)).toBe(0);
    expect(
      await exports.default.getAdminPromotionMediaContent({
        ...request,
        mediaId: uploaded.value.mediaId,
      }),
    ).toMatchObject({ ok: true });
    await exports.default.removeAdminPromotionMedia({
      ...request,
      idempotencyKey: crypto.randomUUID(),
      mediaId: uploaded.value.mediaId,
      expectedVersion: 1,
    });
    const spy = vi
      .spyOn(env.PRODUCT_MEDIA, "delete")
      .mockRejectedValueOnce(new Error("Unavailable"));
    try {
      expect(await cleanPromotionMedia(env.DB, env.PRODUCT_MEDIA)).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(await cleanPromotionMedia(env.DB, env.PRODUCT_MEDIA, Date.now() + 120001)).toBe(1);
    expect(await cleanPromotionMedia(env.DB, env.PRODUCT_MEDIA, Date.now() + 240001)).toBe(0);
  });
  it("uploads, privately previews drafts, publishes without eligibility claims, replaces and removes", async () => {
    const { request } = await fixture();
    const uploaded = await exports.default.uploadAdminPromotionMedia(request);
    if (!uploaded.ok) throw new Error(uploaded.error.message);
    expect(await exports.default.uploadAdminPromotionMedia(request)).toEqual(uploaded);
    expect(
      await exports.default.uploadAdminPromotionMedia({ ...request, altText: "Changed" }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    const mediaId = uploaded.value.mediaId;
    expect(
      await exports.default.getAdminPromotionMediaContent({ ...request, mediaId }),
    ).toMatchObject({ ok: true });
    const publicRequest = { requestId: request.requestId, mediaId, version: 1 };
    expect(await exports.default.getPublishedPromotionMedia(publicRequest)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(
      await exports.default.changeAdminPromotionStatus({
        ...request,
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: 1,
        action: "ACTIVATE",
        reason: "Publish",
      }),
    ).toMatchObject({ ok: true });
    expect(await exports.default.getPublishedPromotionMedia(publicRequest)).toMatchObject({
      ok: true,
      value: { bytes: png },
    });
    expect(
      await exports.default.listPublishedPromotionCampaigns({ requestId: request.requestId }),
    ).toMatchObject({
      ok: true,
      value: { items: [{ promotionId: request.promotionId, image: { alt: "Fresh vegetables" } }] },
    });
    const replacement = await exports.default.uploadAdminPromotionMedia({
      ...request,
      idempotencyKey: crypto.randomUUID(),
      expectedMedia: { mediaId, version: 1 },
      altText: "Replacement vegetables",
    });
    if (!replacement.ok) throw new Error(replacement.error.message);
    expect(await exports.default.getPublishedPromotionMedia(publicRequest)).toMatchObject({
      ok: false,
    });
    const removed = await exports.default.removeAdminPromotionMedia({
      ...request,
      idempotencyKey: crypto.randomUUID(),
      mediaId: replacement.value.mediaId,
      expectedVersion: 1,
    });
    expect(removed).toMatchObject({ ok: true, value: { status: "inactive" } });
    expect(
      await exports.default.listPublishedPromotionCampaigns({ requestId: request.requestId }),
    ).toMatchObject({ ok: true, value: { items: [] } });
    expect(await cleanPromotionMedia(env.DB, env.PRODUCT_MEDIA)).toBe(2);
    expect(
      (await env.PRODUCT_MEDIA.list({ prefix: `promotions/${request.promotionId}/` })).objects,
    ).toHaveLength(0);
    expect(await exports.default.uploadAdminPromotionMedia(request)).toEqual(uploaded);
  });
  it("rejects wrong owner, local scope, unauthenticated, disguised and oversized requests", async () => {
    const { request } = await fixture();
    const local = await locationManager("location");
    await env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='promotions.manage'",
    )
      .bind(local.id)
      .run();
    for (const changed of [
      { headers: {} },
      { headers: local.headers },
      { bytes: new Uint8Array([1, 2, 3]).buffer },
      { bytes: new ArrayBuffer(5242881) },
      { promotionId: crypto.randomUUID() },
    ]) {
      expect(
        await exports.default.uploadAdminPromotionMedia({
          ...request,
          ...changed,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).toMatchObject({ ok: false });
    }
    expect(
      (await env.PRODUCT_MEDIA.list({ prefix: `promotions/${request.promotionId}/` })).objects,
    ).toHaveLength(0);
  });
  for (const effect of ["metadata", "audit", "receipt"] as const)
    it(`rolls back attachment when ${effect} is suppressed and safely retries`, async () => {
      const { request } = await fixture();
      const trigger =
        effect === "metadata"
          ? "INSERT ON promotion_media"
          : effect === "audit"
            ? "INSERT ON audit_event WHEN NEW.action='PROMOTION.MEDIA_UPLOADED'"
            : "UPDATE ON idempotency_records WHEN NEW.scope='admin.promotions.media.upload' AND NEW.status='SUCCEEDED'";
      await env.DB.exec(
        `CREATE TRIGGER suppress_campaign_media BEFORE ${trigger} BEGIN SELECT RAISE(IGNORE); END;`,
      );
      try {
        expect(await exports.default.uploadAdminPromotionMedia(request)).toMatchObject({
          ok: false,
        });
      } finally {
        await env.DB.exec("DROP TRIGGER suppress_campaign_media");
      }
      expect(
        await env.DB.prepare("SELECT count(*) count FROM promotion_media WHERE promotion_id=?")
          .bind(request.promotionId)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare(
          "SELECT status FROM idempotency_records WHERE scope='admin.promotions.media.upload' AND idempotency_key=?",
        )
          .bind(request.idempotencyKey)
          .first(),
      ).toEqual({ status: "PROCESSING" });
      expect(await exports.default.uploadAdminPromotionMedia(request)).toMatchObject({ ok: true });
    });
  it("recovers both lost storage responses and failed writes using the original object identity", async () => {
    for (const stored of [true, false]) {
      const { request } = await fixture();
      const put = env.PRODUCT_MEDIA.put.bind(env.PRODUCT_MEDIA);
      const spy = vi.spyOn(env.PRODUCT_MEDIA, "put").mockImplementationOnce(async (...args) => {
        if (stored) await put(...args);
        throw new Error("Lost response");
      });
      try {
        expect(
          await uploadAdminPromotionMedia(
            { db: env.DB, bucket: env.PRODUCT_MEDIA, auth: createAuth(env) },
            request,
          ),
        ).toMatchObject({ ok: false });
      } finally {
        spy.mockRestore();
      }
      expect(await exports.default.uploadAdminPromotionMedia(request)).toMatchObject({ ok: true });
      expect(
        (await env.PRODUCT_MEDIA.list({ prefix: `promotions/${request.promotionId}/` })).objects,
      ).toHaveLength(1);
    }
  });
  it("allows one concurrent primary attachment and no success receipt for the loser", async () => {
    const { request } = await fixture();
    const outcomes = await Promise.all([
      exports.default.uploadAdminPromotionMedia(request),
      exports.default.uploadAdminPromotionMedia({
        ...request,
        idempotencyKey: crypto.randomUUID(),
      }),
    ]);
    expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare(
        "SELECT count(*) count FROM promotion_media WHERE promotion_id=? AND status='active'",
      )
        .bind(request.promotionId)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare(
        "SELECT count(*) count FROM promotion_media_upload u JOIN idempotency_records i ON i.scope=u.command_scope AND i.idempotency_key=u.idempotency_key WHERE u.promotion_id=? AND i.status='SUCCEEDED'",
      )
        .bind(request.promotionId)
        .first(),
    ).toEqual({ count: 1 });
  });
});
