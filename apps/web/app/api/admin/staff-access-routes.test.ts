import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => ({
  listAdminStaff: vi.fn(),
  getAdminStaff: vi.fn(),
  listAdminStaffInvitations: vi.fn(),
  inviteAdminStaff: vi.fn(),
  revokeAdminStaffInvitation: vi.fn(),
  updateAdminStaff: vi.fn(),
  changeAdminStaffAccess: vi.fn(),
  setAdminStaffRoles: vi.fn(),
  setAdminStaffScopes: vi.fn(),
  revokeAdminStaffSessions: vi.fn(),
  listAdminRoles: vi.fn(),
  getAdminRole: vi.fn(),
  createAdminRole: vi.fn(),
  updateAdminRole: vi.fn(),
  setAdminRoleCapabilities: vi.fn(),
  archiveAdminRole: vi.fn(),
  listCapabilityDefinitions: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: { CORE: coreMocks },
}));

import { GET as listStaff } from "./staff/route";
import { GET as getStaff, PATCH as updateStaff } from "./staff/[staff-id]/route";
import { POST as invite } from "./staff/invitations/route";
import { POST as revokeInvitation } from "./staff/invitations/[invitation-id]/revoke/route";
import { POST as changeAccess } from "./staff/[staff-id]/access/route";
import { PUT as setRoles } from "./staff/[staff-id]/roles/route";
import { PUT as setScopes } from "./staff/[staff-id]/scopes/route";
import { POST as revokeSessions } from "./staff/[staff-id]/sessions/revoke/route";
import { GET as listRoles, POST as createRole } from "./roles/route";
import { GET as getRole, PATCH as updateRole } from "./roles/[role-id]/route";
import { PUT as setCapabilities } from "./roles/[role-id]/capabilities/route";
import { POST as archiveRole } from "./roles/[role-id]/archive/route";
import { GET as capabilities } from "./capabilities/route";

beforeEach(() => {
  for (const mock of Object.values(coreMocks)) mock.mockReset();
});

const COOKIE = { cookie: "session=abc" };
const staffParams = { params: Promise.resolve({ "staff-id": "st-1" }) };
const roleParams = { params: Promise.resolve({ "role-id": "ro-1" }) };
const invitationParams = { params: Promise.resolve({ "invitation-id": "inv-1" }) };

function jsonRequest(url: string, body: unknown, key = "idem-1"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key, ...COOKIE },
    body: JSON.stringify(body),
  });
}

describe("staff access BFF routes", () => {
  it("delegates the staff list with query parameters and cookies", async () => {
    coreMocks.listAdminStaff.mockResolvedValue({
      ok: true,
      value: { items: [], nextCursor: null },
      requestId: "r",
    });
    const response = await listStaff(
      new Request("https://freshmarkets.ph/api/admin/staff?limit=10", { headers: COOKIE }),
    );
    expect(response.status).toBe(200);
    expect(coreMocks.listAdminStaff).toHaveBeenCalledTimes(1);
    const input = coreMocks.listAdminStaff.mock.calls[0][0] as Record<string, unknown>;
    expect(input.limit).toBe(10);
    expect((input.headers as Record<string, string>).cookie).toBe("session=abc");
  });

  it("forwards the staff path id", async () => {
    coreMocks.getAdminStaff.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    await getStaff(
      new Request("https://freshmarkets.ph/api/admin/staff/st-1", { headers: COOKIE }),
      staffParams,
    );
    expect(coreMocks.getAdminStaff.mock.calls[0][0].staffId).toBe("st-1");
  });

  it("delegates staff profile edits with the current aggregate version", async () => {
    coreMocks.updateAdminStaff.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    const response = await updateStaff(
      new Request("https://freshmarkets.ph/api/admin/staff/st-1", {
        method: "PATCH",
        headers: { "content-type": "application/json", "idempotency-key": "profile-1", ...COOKIE },
        body: JSON.stringify({ displayName: "Updated name", expectedVersion: 4 }),
      }),
      staffParams,
    );
    expect(response.status).toBe(200);
    expect(coreMocks.updateAdminStaff.mock.calls[0][0]).toMatchObject({
      staffId: "st-1",
      displayName: "Updated name",
      expectedVersion: 4,
      idempotencyKey: "profile-1",
    });
  });

  it("rejects invitations without an idempotency key without calling Core", async () => {
    const response = await invite(
      new Request("https://freshmarkets.ph/api/admin/staff/invitations", {
        method: "POST",
        headers: { "content-type": "application/json", ...COOKIE },
        body: JSON.stringify({ email: "a@example.com", displayName: "A" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(coreMocks.inviteAdminStaff).not.toHaveBeenCalled();
  });

  it("delegates invitation creation with the header key", async () => {
    coreMocks.inviteAdminStaff.mockResolvedValue({
      ok: true,
      value: { invitationId: "i1" },
      requestId: "r",
    });
    const response = await invite(
      jsonRequest("https://freshmarkets.ph/api/admin/staff/invitations", {
        email: "a@example.com",
        displayName: "A",
      }),
    );
    expect(response.status).toBe(200);
    const input = coreMocks.inviteAdminStaff.mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({
      email: "a@example.com",
      displayName: "A",
      idempotencyKey: "idem-1",
    });
  });

  it("delegates invitation revocation through its purpose-built route", async () => {
    coreMocks.revokeAdminStaffInvitation.mockResolvedValue({
      ok: true,
      value: { invitationId: "inv-1", status: "REVOKED" },
      requestId: "r",
    });
    const response = await revokeInvitation(
      jsonRequest("https://freshmarkets.ph/api/admin/staff/invitations/inv-1/revoke", {
        reason: "withdrawn",
      }),
      invitationParams,
    );
    expect(response.status).toBe(200);
    expect(coreMocks.revokeAdminStaffInvitation.mock.calls[0][0]).toMatchObject({
      invitationId: "inv-1",
      reason: "withdrawn",
      idempotencyKey: "idem-1",
    });
  });

  it("delegates access changes with a closed action and integer version", async () => {
    coreMocks.changeAdminStaffAccess.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    const response = await changeAccess(
      jsonRequest("https://freshmarkets.ph/api/admin/staff/st-1/access", {
        action: "SUSPEND",
        reason: "leave",
        expectedVersion: 3,
      }),
      staffParams,
    );
    expect(response.status).toBe(200);
    const input = coreMocks.changeAdminStaffAccess.mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({ staffId: "st-1", action: "SUSPEND", expectedVersion: 3 });
  });

  it("delegates role and scope replacement through PUT", async () => {
    coreMocks.setAdminStaffRoles.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.setAdminStaffScopes.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    await setRoles(
      new Request("https://freshmarkets.ph/api/admin/staff/st-1/roles", {
        method: "PUT",
        headers: { "content-type": "application/json", "idempotency-key": "k", ...COOKIE },
        body: JSON.stringify({ roleIds: ["r1"], expectedVersion: 1 }),
      }),
      staffParams,
    );
    await setScopes(
      new Request("https://freshmarkets.ph/api/admin/staff/st-1/scopes", {
        method: "PUT",
        headers: { "content-type": "application/json", "idempotency-key": "k", ...COOKIE },
        body: JSON.stringify({ scopes: [{ kind: "global" }], expectedVersion: 2 }),
      }),
      staffParams,
    );
    expect(coreMocks.setAdminStaffRoles).toHaveBeenCalledTimes(1);
    expect(coreMocks.setAdminStaffScopes).toHaveBeenCalledTimes(1);
    expect(coreMocks.setAdminStaffScopes.mock.calls[0][0]).toMatchObject({
      scopes: [{ kind: "global" }],
      expectedVersion: 2,
    });
  });

  it("delegates session revocation with the path id and reason", async () => {
    coreMocks.revokeAdminStaffSessions.mockResolvedValue({
      ok: true,
      value: { revokedSessionCount: 1 },
      requestId: "r",
    });
    await revokeSessions(
      jsonRequest("https://freshmarkets.ph/api/admin/staff/st-1/sessions/revoke", {
        reason: "offboard",
      }),
      staffParams,
    );
    expect(coreMocks.revokeAdminStaffSessions.mock.calls[0][0]).toMatchObject({
      staffId: "st-1",
      reason: "offboard",
    });
  });

  it("delegates role list, creation, detail, update, capabilities, and archive", async () => {
    coreMocks.listAdminRoles.mockResolvedValue({ ok: true, value: { items: [] }, requestId: "r" });
    coreMocks.getAdminRole.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.updateAdminRole.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.setAdminRoleCapabilities.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    coreMocks.archiveAdminRole.mockResolvedValue({ ok: true, value: {}, requestId: "r" });

    await listRoles(new Request("https://freshmarkets.ph/api/admin/roles", { headers: COOKIE }));
    await getRole(
      new Request("https://freshmarkets.ph/api/admin/roles/ro-1", { headers: COOKIE }),
      roleParams,
    );
    await updateRole(
      new Request("https://freshmarkets.ph/api/admin/roles/ro-1", {
        method: "PATCH",
        headers: { "content-type": "application/json", "idempotency-key": "k", ...COOKIE },
        body: JSON.stringify({ name: "N", description: "D", expectedVersion: 1 }),
      }),
      roleParams,
    );
    await setCapabilities(
      new Request("https://freshmarkets.ph/api/admin/roles/ro-1/capabilities", {
        method: "PUT",
        headers: { "content-type": "application/json", "idempotency-key": "k", ...COOKIE },
        body: JSON.stringify({ capabilityCodes: ["audit.read"], expectedVersion: 2 }),
      }),
      roleParams,
    );
    await archiveRole(
      jsonRequest("https://freshmarkets.ph/api/admin/roles/ro-1/archive", {
        reason: "done",
        expectedVersion: 3,
      }),
      roleParams,
    );

    expect(coreMocks.getAdminRole.mock.calls[0][0].roleId).toBe("ro-1");
    expect(coreMocks.setAdminRoleCapabilities.mock.calls[0][0]).toMatchObject({
      capabilityCodes: ["audit.read"],
      expectedVersion: 2,
    });
    expect(coreMocks.archiveAdminRole.mock.calls[0][0]).toMatchObject({
      reason: "done",
      expectedVersion: 3,
    });
  });

  it("delegates role creation and the capability vocabulary", async () => {
    coreMocks.createAdminRole.mockResolvedValue({
      ok: true,
      value: { roleId: "ro-9" },
      requestId: "r",
    });
    coreMocks.listCapabilityDefinitions.mockResolvedValue({ ok: true, value: [], requestId: "r" });

    const created = await createRole(
      jsonRequest("https://freshmarkets.ph/api/admin/roles", {
        code: "ops",
        name: "Ops",
        description: "",
        capabilityCodes: ["orders.read"],
      }),
    );
    expect(created.status).toBe(200);
    const input = coreMocks.createAdminRole.mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({ code: "ops", idempotencyKey: "idem-1" });

    await capabilities(
      new Request("https://freshmarkets.ph/api/admin/capabilities", { headers: COOKIE }),
    );
    expect(coreMocks.listCapabilityDefinitions).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for a malformed limit without calling Core", async () => {
    const response = await listStaff(
      new Request("https://freshmarkets.ph/api/admin/staff?limit=abc", { headers: COOKIE }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});
