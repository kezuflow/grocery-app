import { describe, it, expect, vi } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { createAuth } from "../../auth/service";
import { uploadAdminBannerMedia } from "./banner-media";
import { cleanBannerMedia } from "./banner-media-storage";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]).buffer;
async function fixture() {
  const manager = await locationManager();
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('promotions.read','promotions.manage')",
  )
    .bind(manager.id)
    .run();
  const request = {
    headers: manager.headers,
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    bannerId: crypto.randomUUID(),
    expectedVersion: 0,
    name: "Seasonal collection",
    href: "/#catalog",
    status: "DRAFT" as const,
    priority: 2,
    startsAt: Date.now() - 10000,
    endsAt: null,
  };
  const saved = await exports.default.saveAdminBanner(request);
  expect(saved.ok).toBe(true);
  return { manager, request };
}
async function upload(request: Awaited<ReturnType<typeof fixture>>["request"]) {
  return exports.default.uploadAdminBannerMedia({
    ...request,
    idempotencyKey: crypto.randomUUID(),
    expectedMedia: null,
    altText: "Seasonal vegetables",
    bytes: png,
    mimeType: "image/png",
  });
}
describe("Standalone storefront banners", () => {
  it("creates independently of promotions, publishes with an image, and withdraws immediately", async () => {
    const before = await env.DB.prepare("SELECT count(*) n FROM promotion").first<{ n: number }>();
    const { request } = await fixture();
    const image = await upload(request);
    expect(image.ok).toBe(true);
    const active = {
      ...request,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 1,
      status: "ACTIVE" as const,
    };
    expect((await exports.default.saveAdminBanner(active)).ok).toBe(true);
    const list = await exports.default.listPublishedBanners({ requestId: request.requestId });
    expect(list).toMatchObject({
      ok: true,
      value: { items: [{ bannerId: request.bannerId, name: request.name, href: "/#catalog" }] },
    });
    expect(await env.DB.prepare("SELECT count(*) n FROM promotion").first()).toEqual(before);
    if (!image.ok) throw new Error("upload");
    expect((await exports.default.getPublishedBannerMedia({ ...request, ...image.value })).ok).toBe(
      true,
    );
    expect(
      (
        await exports.default.saveAdminBanner({
          ...active,
          idempotencyKey: crypto.randomUUID(),
          expectedVersion: 2,
          status: "INACTIVE",
        })
      ).ok,
    ).toBe(true);
    expect(
      await exports.default.listPublishedBanners({ requestId: request.requestId }),
    ).toMatchObject({ ok: true, value: { items: [] } });
    expect((await exports.default.getPublishedBannerMedia({ ...request, ...image.value })).ok).toBe(
      false,
    );
  });
  it("rejects publishing without an image without partial effects, and replays immutable receipts", async () => {
    const { request } = await fixture();
    const result = await exports.default.saveAdminBanner({
      ...request,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 1,
      status: "ACTIVE",
    });
    expect(result.ok).toBe(false);
    const replay = await exports.default.saveAdminBanner(request);
    expect(replay).toMatchObject({ ok: true, value: { version: 1, status: "DRAFT" } });
    expect(
      await env.DB.prepare(
        "SELECT count(*) n FROM audit_event WHERE aggregate_id=? AND action='BANNER.SAVED'",
      )
        .bind(request.bannerId)
        .first(),
    ).toEqual({ n: 1 });
  });
  it("rejects stale updates, changed retry identities and unsafe links", async () => {
    const { request } = await fixture();
    expect((await exports.default.saveAdminBanner({ ...request, name: "Changed" })).ok).toBe(false);
    for (const href of ["https://example.com", "//example.com", "/\\example.com"])
      expect(
        (
          await exports.default.saveAdminBanner({
            ...request,
            idempotencyKey: crypto.randomUUID(),
            href,
          })
        ).ok,
      ).toBe(false);
    expect(
      (
        await exports.default.saveAdminBanner({
          ...request,
          idempotencyKey: crypto.randomUUID(),
          expectedVersion: 99,
        })
      ).ok,
    ).toBe(false);
  });
  it("enforces schedule boundaries and optional non-clickable banners", async () => {
    const { request } = await fixture();
    await upload(request);
    await exports.default.saveAdminBanner({
      ...request,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 1,
      status: "ACTIVE",
      href: null,
      startsAt: 1000,
      endsAt: 2000,
    });
    const clock = vi.spyOn(Date, "now");
    try {
      for (const [time, count] of [
        [999, 0],
        [1000, 1],
        [1999, 1],
        [2000, 0],
      ]) {
        clock.mockReturnValue(time);
        const r = await exports.default.listPublishedBanners({ requestId: request.requestId });
        if (!r.ok) throw new Error(r.error.message);
        expect(r.value.items.length).toBe(count);
        if (count) expect(r.value.items[0]?.href).toBeNull();
      }
    } finally {
      clock.mockRestore();
    }
  });
  it("requires authenticated Global access for mutations", async () => {
    const { request } = await fixture();
    expect(
      (
        await exports.default.saveAdminBanner({
          ...request,
          headers: {},
          idempotencyKey: crypto.randomUUID(),
          expectedVersion: 1,
        })
      ).ok,
    ).toBe(false);
    await env.DB.prepare("DELETE FROM staff_scope WHERE scope_kind='global'").run();
    expect(
      (
        await exports.default.saveAdminBanner({
          ...request,
          idempotencyKey: crypto.randomUUID(),
          expectedVersion: 1,
        })
      ).ok,
    ).toBe(false);
  });
  it("recovers unknown image storage using the same immutable object", async () => {
    const { request } = await fixture();
    const put = vi.spyOn(env.PRODUCT_MEDIA, "put");
    put.mockRejectedValueOnce(new Error("network"));
    const input = {
      ...request,
      idempotencyKey: crypto.randomUUID(),
      expectedMedia: null,
      altText: "Image",
      bytes: png,
      mimeType: "image/png" as const,
    };
    try {
      expect(
        (
          await uploadAdminBannerMedia(
            { db: env.DB, bucket: env.PRODUCT_MEDIA, auth: createAuth(env) },
            input,
          )
        ).ok,
      ).toBe(false);
      put.mockRestore();
      expect((await exports.default.uploadAdminBannerMedia(input)).ok).toBe(true);
      expect((await exports.default.uploadAdminBannerMedia(input)).ok).toBe(true);
    } finally {
      put.mockRestore();
    }
  });
  it("removes publication before cleaning stored image", async () => {
    const { request } = await fixture();
    const image = await upload(request);
    if (!image.ok) throw new Error("upload");
    expect(
      (
        await exports.default.removeAdminBannerMedia({
          ...request,
          idempotencyKey: crypto.randomUUID(),
          mediaId: image.value.mediaId,
          expectedVersion: 1,
        })
      ).ok,
    ).toBe(true);
    expect(await cleanBannerMedia(env.DB, env.PRODUCT_MEDIA)).toBe(1);
  });
});
