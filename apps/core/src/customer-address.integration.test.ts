import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;
const password = "correct-horse-battery-staple";

function requestId() {
  return crypto.randomUUID();
}

function cookieHeader(response: Response): string {
  return (response.headers.getSetCookie?.() ?? [])
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

async function account() {
  const email = `address-${crypto.randomUUID()}@example.com`;
  const signUp = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Address Test", email, password }),
  });
  expect(signUp.status).toBeLessThan(400);
  const body = (await signUp.json()) as { user?: { id?: string } };
  expect(body.user?.id).toBeTruthy();
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(body.user!.id).run();
  const signIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ email, password }),
  });
  expect(signIn.status).toBeLessThan(400);
  return {
    userId: body.user!.id!,
    cookie: cookieHeader(signIn),
    request: () => ({ headers: { cookie: cookieHeader(signIn) }, requestId: requestId() }),
  };
}

async function createAddress(request: ReturnType<Awaited<ReturnType<typeof account>>["request"]>) {
  return core.createCustomerAddress({
    ...request,
    label: "Home",
    recipient: "Recipient",
    phone: "09000000000",
    addressJson: JSON.stringify({ line1: "Cebu City" }),
    latitude: 10.32,
    longitude: 123.9,
  });
}

describe("Phase 4B customer addresses", () => {
  it("lists an empty owner-scoped address collection and creates through the boundary", async () => {
    const user = await account();
    await expect(core.listCustomerAddresses(user.request())).resolves.toMatchObject({
      ok: true,
      value: [],
    });
    const created = await createAddress(user.request());
    expect(created).toMatchObject({ ok: true, value: { status: "active", version: 1 } });
    if (!created.ok) return;
    const listed = await core.listCustomerAddresses(user.request());
    expect(listed).toMatchObject({ ok: true, value: [created.value] });
    expect(created.value.serviceAreaCode).toBe("CEBU_CITY");
    expect(created.value.deliveryZoneCode).toBe("CEBU_CITY_CORE");
  });

  it("updates with the correct version and rejects stale versions", async () => {
    const user = await account();
    const created = await createAddress(user.request());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const updated = await core.updateCustomerAddress({
      ...user.request(),
      addressId: created.value.id,
      expectedVersion: created.value.version,
      label: "Work",
    });
    expect(updated).toMatchObject({ ok: true, value: { label: "Work", version: 2 } });
    if (!updated.ok) return;
    const stale = await core.updateCustomerAddress({
      ...user.request(),
      addressId: created.value.id,
      expectedVersion: created.value.version,
      label: "Old",
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
  });

  it("rejects foreign address IDs and never trusts client ownership", async () => {
    const owner = await account();
    const other = await account();
    const created = await createAddress(owner.request());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const list = await core.listCustomerAddresses(other.request());
    expect(list).toMatchObject({ ok: true, value: [] });
    const forged = await core.updateCustomerAddress({
      ...other.request(),
      addressId: created.value.id,
      expectedVersion: created.value.version,
      label: "Stolen",
    });
    expect(forged).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("blocks list, create, and update when the principal is disabled", async () => {
    const user = await account();
    const created = await createAddress(user.request());
    expect(created.ok).toBe(true);
    const principal = await env.DB.prepare("SELECT id FROM customer_principal WHERE auth_user_id=?")
      .bind(user.userId)
      .first<{ id: string }>();
    await env.DB.prepare("UPDATE customer_principal SET status='disabled' WHERE id=?")
      .bind(principal!.id)
      .run();
    expect(await core.listCustomerAddresses(user.request())).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await createAddress(user.request())).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    if (created.ok)
      expect(
        await core.updateCustomerAddress({
          ...user.request(),
          addressId: created.value.id,
          expectedVersion: created.value.version,
          label: "Blocked",
        }),
      ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("re-resolves serviceability for location changes and preserves it for unrelated edits", async () => {
    const user = await account();
    const created = await createAddress(user.request());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const moved = await core.updateCustomerAddress({
      ...user.request(),
      addressId: created.value.id,
      expectedVersion: created.value.version,
      latitude: 11,
      longitude: 124,
    });
    expect(moved).toMatchObject({
      ok: true,
      value: { latitude: 11, longitude: 124, serviceAreaCode: null, deliveryZoneCode: null },
    });
    if (!moved.ok) return;
    const renamed = await core.updateCustomerAddress({
      ...user.request(),
      addressId: moved.value.id,
      expectedVersion: moved.value.version,
      addressJson: JSON.stringify({ line1: "Updated label only" }),
    });
    expect(renamed).toMatchObject({
      ok: true,
      value: { serviceAreaCode: null, deliveryZoneCode: null, resolutionVersion: null },
    });
  });
});
