import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => ({
  listAdminPromotions: vi.fn(),
  getAdminPromotion: vi.fn(),
  createAdminPromotion: vi.fn(),
  updateAdminPromotion: vi.fn(),
  changeAdminPromotionStatus: vi.fn(),
  previewAdminPromotion: vi.fn(),
  grantAdminPromotion: vi.fn(),
  listPromotionGrants: vi.fn(),
  listPromotionRedemptions: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: { CORE: coreMocks },
}));

import { GET as listPromotions, POST as createPromotion } from "./promotions/route";
import { GET as getPromotion, PATCH as updatePromotion } from "./promotions/[promotion-id]/route";
import { POST as changeStatus } from "./promotions/[promotion-id]/status/route";
import { POST as preview } from "./promotions/[promotion-id]/preview/route";
import { GET as listGrants, POST as grant } from "./promotions/[promotion-id]/grants/route";
import { GET as listRedemptions } from "./promotions/[promotion-id]/redemptions/route";

beforeEach(() => {
  for (const mock of Object.values(coreMocks)) mock.mockReset();
});

const COOKIE = { cookie: "session=abc" };
const promoParams = { params: Promise.resolve({ "promotion-id": "promo-1" }) };

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "idem-1", ...COOKIE },
    body: JSON.stringify(body),
  });
}

describe("promotion BFF routes", () => {
  it("delegates the promotion list with query parameters and cookies", async () => {
    coreMocks.listAdminPromotions.mockResolvedValue({ ok: true, value: { items: [] }, requestId: "r" });
    const response = await listPromotions(
      new Request("https://freshmarkets.ph/api/admin/promotions?limit=25", { headers: COOKIE }),
    );
    expect(response.status).toBe(200);
    const input = coreMocks.listAdminPromotions.mock.calls[0][0] as Record<string, unknown>;
    expect(input.limit).toBe(25);
    expect((input.headers as Record<string, string>).cookie).toBe("session=abc");
  });

  it("delegates creation with the idempotency key and closed fields", async () => {
    coreMocks.createAdminPromotion.mockResolvedValue({ ok: true, value: { promotionId: "p1" }, requestId: "r" });
    const response = await createPromotion(
      jsonRequest("https://freshmarkets.ph/api/admin/promotions", {
        code: "TEST_1",
        name: "Test",
        benefitType: "ORDER_FIXED_DISCOUNT",
        discountMinor: 100,
        minimumMinor: 500,
        startsAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    expect(response.status).toBe(200);
    const input = coreMocks.createAdminPromotion.mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({ code: "TEST_1", idempotencyKey: "idem-1" });
  });

  it("forwards the promotion path id for detail, status, preview, grants, and redemptions", async () => {
    coreMocks.getAdminPromotion.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.changeAdminPromotionStatus.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.previewAdminPromotion.mockResolvedValue({ ok: true, value: { eligible: true }, requestId: "r" });
    coreMocks.listPromotionGrants.mockResolvedValue({ ok: true, value: { items: [] }, requestId: "r" });
    coreMocks.listPromotionRedemptions.mockResolvedValue({ ok: true, value: { items: [] }, requestId: "r" });

    await getPromotion(new Request("https://x/p1", { headers: COOKIE }), promoParams);
    await changeStatus(
      jsonRequest("https://x/p1/status", { action: "ACTIVATE", reason: "go", expectedVersion: 1 }),
      promoParams,
    );
    await preview(jsonRequest("https://x/p1/preview", { subtotalMinor: 5000 }), promoParams);
    await listGrants(
      new Request("https://x/p1/grants?cursor=grant-next&limit=25", { headers: COOKIE }),
      promoParams,
    );
    await listRedemptions(
      new Request("https://x/p1/redemptions?cursor=redemption-next&limit=10", { headers: COOKIE }),
      promoParams,
    );

    for (const mock of [
      coreMocks.getAdminPromotion,
      coreMocks.changeAdminPromotionStatus,
      coreMocks.previewAdminPromotion,
      coreMocks.listPromotionGrants,
      coreMocks.listPromotionRedemptions,
    ]) {
      expect((mock.mock.calls[0][0] as Record<string, unknown>).promotionId).toBe("promo-1");
    }
    expect(coreMocks.listPromotionGrants.mock.calls[0][0]).toMatchObject({
      cursor: "grant-next",
      limit: 25,
    });
    expect(coreMocks.listPromotionRedemptions.mock.calls[0][0]).toMatchObject({
      cursor: "redemption-next",
      limit: 10,
    });
  });

  it("delegates updates and grants with the idempotency key", async () => {
    coreMocks.updateAdminPromotion.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.grantAdminPromotion.mockResolvedValue({ ok: true, value: { grantId: "g1" }, requestId: "r" });

    await updatePromotion(
      new Request("https://x/p1", {
        method: "PATCH",
        headers: { "content-type": "application/json", "idempotency-key": "idem-9", ...COOKIE },
        body: JSON.stringify({
          name: "N",
          minimumMinor: 0,
          startsAt: "2026-01-01T00:00:00.000Z",
          expectedVersion: 3,
        }),
      }),
      promoParams,
    );
    await grant(
      jsonRequest("https://x/p1/grants", { customerId: "cust-1", maxRedemptions: 1 }),
      promoParams,
    );

    expect(coreMocks.updateAdminPromotion.mock.calls[0][0]).toMatchObject({
      promotionId: "promo-1",
      expectedVersion: 3,
      idempotencyKey: "idem-9",
    });
    expect(coreMocks.grantAdminPromotion.mock.calls[0][0]).toMatchObject({
      customerId: "cust-1",
      maxRedemptions: 1,
    });
  });

  it("returns 400 for a malformed limit without calling Core", async () => {
    const response = await listPromotions(
      new Request("https://freshmarkets.ph/api/admin/promotions?limit=nope", { headers: COOKIE }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(coreMocks.listAdminPromotions).not.toHaveBeenCalled();
  });
});
