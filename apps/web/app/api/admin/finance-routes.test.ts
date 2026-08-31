import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => ({
  listAdminOrders: vi.fn(),
  getAdminOrder: vi.fn(),
  cancelAdminOrder: vi.fn(),
  listAdminPayments: vi.fn(),
  getAdminPayment: vi.fn(),
  getAdminPaymentOverview: vi.fn(),
  requestAdminRefund: vi.fn(),
  listAdminReconciliationCases: vi.fn(),
  resolveAdminReconciliationCase: vi.fn(),
  listAdminMemberships: vi.fn(),
  getAdminMembership: vi.fn(),
  pauseAdminMembership: vi.fn(),
  resumeAdminMembership: vi.fn(),
  cancelAdminMembership: vi.fn(),
  listAdminOrderIssues: vi.fn(),
  applyAdminOrderIssueAction: vi.fn(),
  getMembershipPriceConfiguration: vi.fn(),
  updateMembershipPriceConfiguration: vi.fn(),
  getServiceFeeConfiguration: vi.fn(),
  updateServiceFeeConfiguration: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: { CORE: coreMocks },
}));

import { GET as listOrders } from "./orders/route";
import { POST as cancelOrder } from "./orders/[order-id]/cancel/route";
import { POST as requestRefund } from "./payments/refunds/route";
import { GET as paymentOverview } from "./payments/overview/route";
import { GET as paymentDetail } from "./payments/[payment-intent-id]/route";
import { GET as listCases } from "./payments/reconciliation/route";
import { POST as resolveCase } from "./payments/reconciliation/[case-id]/resolve/route";
import { GET as listIssues } from "./order-issues/route";
import { POST as issueAction } from "./order-issues/[issue-id]/actions/route";
import {
  GET as membershipPrice,
  POST as updateMembershipPrice,
} from "./commerce-configuration/membership-price/route";
import {
  GET as serviceFee,
  POST as updateServiceFee,
} from "./commerce-configuration/service-fee/route";

beforeEach(() => {
  for (const mock of Object.values(coreMocks)) mock.mockReset();
});

const COOKIE = { cookie: "session=abc" };

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "idem-1", ...COOKIE },
    body: JSON.stringify(body),
  });
}

describe("finance BFF routes", () => {
  it("delegates order list/detail/cancel with the path id and idempotency key", async () => {
    coreMocks.listAdminOrders.mockResolvedValue({ ok: true, value: { items: [] }, requestId: "r" });
    coreMocks.cancelAdminOrder.mockResolvedValue({ ok: true, value: {}, requestId: "r" });

    await listOrders(new Request("https://x/orders?status=COMMITTED", { headers: COOKIE }));
    await cancelOrder(
      jsonRequest("https://x/orders/o1/cancel", {
        reasonCode: "customer request",
        expectedVersion: 1,
      }),
      { params: Promise.resolve({ "order-id": "o1" }) },
    );

    expect(coreMocks.listAdminOrders.mock.calls[0][0].status).toBe("COMMITTED");
    expect(coreMocks.cancelAdminOrder.mock.calls[0][0]).toMatchObject({
      orderId: "o1",
      reasonCode: "customer request",
      idempotencyKey: "idem-1",
    });
  });

  it("delegates refunds, reconciliation list, and case resolution", async () => {
    coreMocks.requestAdminRefund.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.listAdminReconciliationCases.mockResolvedValue({
      ok: true,
      value: { items: [] },
      requestId: "r",
    });
    coreMocks.resolveAdminReconciliationCase.mockResolvedValue({
      ok: true,
      value: {},
      requestId: "r",
    });

    await requestRefund(
      jsonRequest("https://x/refunds", {
        paymentIntentId: "pi-1",
        amountMinor: 500,
        reason: "goodwill",
      }),
    );
    await listCases(new Request("https://x/reconciliation?status=OPEN", { headers: COOKIE }));
    await resolveCase(jsonRequest("https://x/reconciliation/c1/resolve", { reason: "matched" }), {
      params: Promise.resolve({ "case-id": "c1" }),
    });

    expect(coreMocks.requestAdminRefund.mock.calls[0][0]).toMatchObject({
      paymentIntentId: "pi-1",
      amountMinor: 500,
    });
    expect(coreMocks.listAdminReconciliationCases.mock.calls[0][0].status).toBe("OPEN");
    expect(coreMocks.resolveAdminReconciliationCase.mock.calls[0][0].caseId).toBe("c1");
  });

  it("delegates payment overview and detail through typed Core methods", async () => {
    coreMocks.getAdminPaymentOverview.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.getAdminPayment.mockResolvedValue({ ok: true, value: {}, requestId: "r" });

    await paymentOverview(new Request("https://x/payments/overview", { headers: COOKIE }));
    await paymentDetail(new Request("https://x/payments/pi-1", { headers: COOKIE }), {
      params: Promise.resolve({ "payment-intent-id": "pi-1" }),
    });

    expect(coreMocks.getAdminPaymentOverview).toHaveBeenCalledOnce();
    expect(coreMocks.getAdminPayment.mock.calls[0][0]).toMatchObject({ paymentIntentId: "pi-1" });
  });

  it("delegates the issue queue and closed actions", async () => {
    coreMocks.listAdminOrderIssues.mockResolvedValue({
      ok: true,
      value: { items: [] },
      requestId: "r",
    });
    coreMocks.applyAdminOrderIssueAction.mockResolvedValue({ ok: true, value: {}, requestId: "r" });

    await listIssues(new Request("https://x/issues?status=SUBMITTED", { headers: COOKIE }));
    await issueAction(
      jsonRequest("https://x/issues/i1/actions", {
        action: "CLAIM",
        reason: "mine",
        expectedVersion: 1,
      }),
      { params: Promise.resolve({ "issue-id": "i1" }) },
    );

    expect(coreMocks.listAdminOrderIssues.mock.calls[0][0].status).toBe("SUBMITTED");
    expect(coreMocks.applyAdminOrderIssueAction.mock.calls[0][0]).toMatchObject({
      issueId: "i1",
      action: "CLAIM",
    });
  });

  it("rejects refund requests without an idempotency key without calling Core", async () => {
    const response = await requestRefund(
      new Request("https://x/refunds", {
        method: "POST",
        headers: { "content-type": "application/json", ...COOKIE },
        body: JSON.stringify({ paymentIntentId: "pi-1", amountMinor: 100, reason: "x" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(coreMocks.requestAdminRefund).not.toHaveBeenCalled();
  });

  it("delegates effective-dated commerce configuration reads and versioned commands", async () => {
    coreMocks.getMembershipPriceConfiguration.mockResolvedValue({
      ok: true,
      value: {},
      requestId: "r",
    });
    coreMocks.updateMembershipPriceConfiguration.mockResolvedValue({
      ok: true,
      value: {},
      requestId: "r",
    });
    coreMocks.getServiceFeeConfiguration.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.updateServiceFeeConfiguration.mockResolvedValue({
      ok: true,
      value: {},
      requestId: "r",
    });

    await membershipPrice(new Request("https://x/membership-price", { headers: COOKIE }));
    await updateMembershipPrice(
      jsonRequest("https://x/membership-price", {
        expectedVersion: 3,
        amountMinor: 35_000,
        currency: "PHP",
        effectiveFrom: "2026-09-01T00:00:00.000Z",
        reason: "Approved annual review",
      }),
    );
    await serviceFee(new Request("https://x/service-fee", { headers: COOKIE }));
    await updateServiceFee(
      jsonRequest("https://x/service-fee", {
        expectedVersion: 4,
        feeType: "MIXED",
        flatMinor: 1_500,
        percentageBasisPoints: 250,
        currency: "PHP",
        effectiveFrom: "2026-09-01T00:00:00.000Z",
        reason: "Approved fee review",
      }),
    );

    expect(coreMocks.updateMembershipPriceConfiguration.mock.calls[0][0]).toMatchObject({
      expectedVersion: 3,
      idempotencyKey: "idem-1",
    });
    expect(coreMocks.updateServiceFeeConfiguration.mock.calls[0][0]).toMatchObject({
      expectedVersion: 4,
      feeType: "MIXED",
      idempotencyKey: "idem-1",
    });
  });
});
