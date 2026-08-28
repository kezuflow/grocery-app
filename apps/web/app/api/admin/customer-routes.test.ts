import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => ({
  listAdminCustomers: vi.fn(),
  getAdminCustomer: vi.fn(),
  listCustomerInvitations: vi.fn(),
  inviteCustomer: vi.fn(),
  changeCustomerAccess: vi.fn(),
  revokeCustomerSessions: vi.fn(),
  requestCustomerClosure: vi.fn(),
  listPrivacyRequests: vi.fn(),
  applyPrivacyAction: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: { CORE: coreMocks },
}));

import { GET as listCustomers } from "./customers/route";
import { GET as getCustomer } from "./customers/[customer-id]/route";
import { GET as listInvitations, POST as invite } from "./customers/invitations/route";
import { POST as changeAccess } from "./customers/[customer-id]/access/route";
import { POST as revokeSessions } from "./customers/[customer-id]/sessions/revoke/route";
import { POST as closureRequest } from "./customers/[customer-id]/closure-requests/route";
import { GET as listPrivacy } from "./privacy-requests/route";
import { POST as privacyAction } from "./privacy-requests/[privacy-request-id]/actions/route";

beforeEach(() => {
  for (const mock of Object.values(coreMocks)) mock.mockReset();
});

const COOKIE = { cookie: "session=abc" };
const customerParams = { params: Promise.resolve({ "customer-id": "cust-1" }) };
const privacyParams = { params: Promise.resolve({ "privacy-request-id": "pr-1" }) };

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "idem-1", ...COOKIE },
    body: JSON.stringify(body),
  });
}

describe("customer crm BFF routes", () => {
  it("delegates the customer list with query parameters and cookies", async () => {
    coreMocks.listAdminCustomers.mockResolvedValue({ ok: true, value: { items: [] }, requestId: "r" });
    const response = await listCustomers(
      new Request("https://freshmarkets.ph/api/admin/customers?query=alice&limit=10", { headers: COOKIE }),
    );
    expect(response.status).toBe(200);
    const input = coreMocks.listAdminCustomers.mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({ query: "alice", limit: 10 });
    expect((input.headers as Record<string, string>).cookie).toBe("session=abc");
  });

  it("forwards the customer path id for detail", async () => {
    coreMocks.getAdminCustomer.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    await getCustomer(
      new Request("https://freshmarkets.ph/api/admin/customers/cust-1", { headers: COOKIE }),
      customerParams,
    );
    expect(coreMocks.getAdminCustomer.mock.calls[0][0].customerId).toBe("cust-1");
  });

  it("rejects invitations without an idempotency key without calling Core", async () => {
    const response = await invite(
      new Request("https://freshmarkets.ph/api/admin/customers/invitations", {
        method: "POST",
        headers: { "content-type": "application/json", ...COOKIE },
        body: JSON.stringify({ email: "a@example.com" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(coreMocks.inviteCustomer).not.toHaveBeenCalled();
  });

  it("delegates invitation creation and the invitation queue", async () => {
    coreMocks.inviteCustomer.mockResolvedValue({ ok: true, value: { invitationId: "i1" }, requestId: "r" });
    coreMocks.listCustomerInvitations.mockResolvedValue({ ok: true, value: { items: [] }, requestId: "r" });
    await invite(
      jsonRequest("https://freshmarkets.ph/api/admin/customers/invitations", { email: "a@example.com" }),
    );
    await listInvitations(new Request("https://freshmarkets.ph/api/admin/customers/invitations", { headers: COOKIE }));
    expect(coreMocks.inviteCustomer.mock.calls[0][0]).toMatchObject({
      email: "a@example.com",
      idempotencyKey: "idem-1",
    });
    expect(coreMocks.listCustomerInvitations).toHaveBeenCalledTimes(1);
  });

  it("delegates access change, session revocation, and closure requests with the path id", async () => {
    coreMocks.changeCustomerAccess.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.revokeCustomerSessions.mockResolvedValue({ ok: true, value: { revokedSessionCount: 1 }, requestId: "r" });
    coreMocks.requestCustomerClosure.mockResolvedValue({ ok: true, value: {}, requestId: "r" });

    await changeAccess(
      jsonRequest("https://freshmarkets.ph/api/admin/customers/cust-1/access", {
        action: "DISABLE",
        reason: "review",
        expectedVersion: 2,
      }),
      customerParams,
    );
    await revokeSessions(
      jsonRequest("https://freshmarkets.ph/api/admin/customers/cust-1/sessions/revoke", { reason: "takeover" }),
      customerParams,
    );
    await closureRequest(
      jsonRequest("https://freshmarkets.ph/api/admin/customers/cust-1/closure-requests", {
        requestType: "CLOSURE",
        reason: "customer request",
      }),
      customerParams,
    );

    expect(coreMocks.changeCustomerAccess.mock.calls[0][0]).toMatchObject({
      customerId: "cust-1",
      action: "DISABLE",
      expectedVersion: 2,
    });
    expect(coreMocks.revokeCustomerSessions.mock.calls[0][0]).toMatchObject({
      customerId: "cust-1",
      reason: "takeover",
    });
    expect(coreMocks.requestCustomerClosure.mock.calls[0][0]).toMatchObject({
      customerId: "cust-1",
      requestType: "CLOSURE",
    });
  });

  it("delegates the privacy queue and closed actions", async () => {
    coreMocks.listPrivacyRequests.mockResolvedValue({ ok: true, value: { items: [] }, requestId: "r" });
    coreMocks.applyPrivacyAction.mockResolvedValue({ ok: true, value: {}, requestId: "r" });

    await listPrivacy(
      new Request("https://freshmarkets.ph/api/admin/privacy-requests?status=SUBMITTED", { headers: COOKIE }),
    );
    await privacyAction(
      jsonRequest("https://freshmarkets.ph/api/admin/privacy-requests/pr-1/actions", {
        action: "VERIFY",
        reason: "id checked",
        expectedVersion: 1,
      }),
      privacyParams,
    );

    expect(coreMocks.listPrivacyRequests.mock.calls[0][0].status).toBe("SUBMITTED");
    expect(coreMocks.applyPrivacyAction.mock.calls[0][0]).toMatchObject({
      privacyRequestId: "pr-1",
      action: "VERIFY",
      expectedVersion: 1,
    });
  });

  it("returns 400 for a malformed limit without calling Core", async () => {
    const response = await listCustomers(
      new Request("https://freshmarkets.ph/api/admin/customers?limit=abc", { headers: COOKIE }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(coreMocks.listAdminCustomers).not.toHaveBeenCalled();
  });
});
