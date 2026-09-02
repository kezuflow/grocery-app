import { describe, expect, it, vi } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type {
  AddressComponents,
  CoreServiceBinding,
  DeliveryInstructions,
} from "@freshmarkets/contracts";
import { CoreEntrypoint } from "./index";
import {
  createCustomerAddress as createCustomerAddressCommand,
  updateCustomerAddress as updateCustomerAddressCommand,
} from "./customer/addresses";
import type { GeocoderPort } from "./geography/ports/geocoder";

const core = exports.default as unknown as CoreServiceBinding;
const password = "correct-horse-battery-staple";
const components: AddressComponents = {
  addressLine1: "Ayala Center Cebu",
  addressLine2: null,
  barangay: "Luz",
  city: "Cebu City",
  region: "Central Visayas",
  postalCode: "6000",
  countryCode: "PH",
};
const instructions: DeliveryInstructions = {
  buildingUnit: "Unit 4B",
  landmark: "Across the public market",
  gateGuard: null,
  deliveryNote: "Call on arrival",
  recipientInstruction: "Ask for Ana",
};

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

async function customerIdFor(authUserId: string): Promise<string> {
  const customer = await env.DB.prepare(
    "SELECT c.id FROM customer c JOIN customer_principal p ON p.id=c.principal_id WHERE p.auth_user_id=?",
  )
    .bind(authUserId)
    .first<{ id: string }>();
  expect(customer?.id).toBeTruthy();
  return customer!.id;
}

function geocoder(overrides: Partial<GeocoderPort> = {}): GeocoderPort {
  return {
    async search() {
      return [];
    },
    async reverseTemporary() {
      throw new Error("Unexpected temporary reverse geocode");
    },
    async reversePermanent() {
      throw new Error("Unexpected permanent reverse geocode");
    },
    ...overrides,
  };
}

describe("Phase 4B customer addresses", () => {
  it("permanently reverse-finalizes a geocoder-confirmed pin before inserting it", async () => {
    const user = await account();
    await core.listCustomerAddresses(user.request());
    const customerId = await customerIdFor(user.userId);
    const permanentComponents = { ...components, addressLine1: "Permanent entrance" };
    let reverseCalls = 0;
    const result = await createCustomerAddressCommand(
      env.DB,
      geocoder({
        async reversePermanent(input) {
          reverseCalls += 1;
          expect(input.coordinate).toEqual({ latitude: 10.3173, longitude: 123.9058 });
          const beforeInsert = await env.DB.prepare(
            "SELECT COUNT(*) AS count FROM customer_address WHERE customer_id=?",
          )
            .bind(customerId)
            .first<{ count: number }>();
          expect(beforeInsert?.count).toBe(0);
          return {
            provider: "MAPBOX",
            providerReference: "mapbox.permanent.entrance",
            displayAddress: "Permanent entrance, Cebu City",
            coordinate: { latitude: 10.3, longitude: 123.8 },
            components: permanentComponents,
            accuracy: "rooftop",
          };
        },
      }),
      {
        ...user.request(),
        customerId,
        label: "Home",
        recipient: "Ana",
        phone: "+639171234567",
        latitude: 10.3173,
        longitude: 123.9058,
        components,
        componentsSource: "TEMPORARY_GEOCODER",
        confirmationSource: "GEOCODER",
        instructions,
        addressJson: JSON.stringify({
          candidateKey: "temporary-candidate-must-not-persist",
          rawProviderPayload: "temporary-mapbox-content",
        }),
      },
    );

    expect(reverseCalls).toBe(1);
    expect(result).toMatchObject({
      ok: true,
      value: {
        components: permanentComponents,
        confirmationSource: "GEOCODER",
        latitude: 10.3173,
        longitude: 123.9058,
      },
    });
    if (!result.ok) return;
    expect(Date.parse(result.value.confirmedAt!)).not.toBeNaN();
    const stored = await env.DB.prepare(
      "SELECT address_json, geocode_provider, geocode_reference, latitude, longitude FROM customer_address WHERE id=?",
    )
      .bind(result.value.id)
      .first<{
        address_json: string;
        geocode_provider: string | null;
        geocode_reference: string | null;
        latitude: number;
        longitude: number;
      }>();
    expect(stored).toEqual({
      address_json: JSON.stringify(permanentComponents),
      geocode_provider: "MAPBOX",
      geocode_reference: "mapbox.permanent.entrance",
      latitude: 10.3173,
      longitude: 123.9058,
    });
  });

  it.each(["USER_PIN", "DEVICE_LOCATION"] as const)(
    "permanently replaces temporary provider components at a final %s coordinate",
    async (confirmationSource) => {
      const user = await account();
      await core.listCustomerAddresses(user.request());
      const customerId = await customerIdFor(user.userId);
      const finalCoordinate = { latitude: 10.319, longitude: 123.907 };
      const permanentComponents = { ...components, addressLine1: "Permanent final entrance" };
      let reverseCalls = 0;
      const command = {
        ...user.request(),
        customerId,
        label: "Home",
        recipient: "Ana",
        phone: "+639171234567",
        ...finalCoordinate,
        components,
        componentsSource: "TEMPORARY_GEOCODER" as const,
        confirmationSource,
        instructions,
      };

      const result = await createCustomerAddressCommand(
        env.DB,
        geocoder({
          async reversePermanent(input) {
            reverseCalls += 1;
            expect(input.coordinate).toEqual(finalCoordinate);
            return {
              provider: "MAPBOX",
              providerReference: `mapbox.permanent.${confirmationSource.toLowerCase()}`,
              displayAddress: "Permanent final entrance, Cebu City",
              coordinate: finalCoordinate,
              components: permanentComponents,
              accuracy: "rooftop",
            };
          },
        }),
        command,
      );

      expect(reverseCalls).toBe(1);
      expect(result).toMatchObject({
        ok: true,
        value: {
          components: permanentComponents,
          confirmationSource,
          ...finalCoordinate,
        },
      });
      if (!result.ok) return;
      const stored = await env.DB.prepare(
        "SELECT address_json, geocode_provider, geocode_reference FROM customer_address WHERE id=?",
      )
        .bind(result.value.id)
        .first<{
          address_json: string;
          geocode_provider: string | null;
          geocode_reference: string | null;
        }>();
      expect(stored).toEqual({
        address_json: JSON.stringify(permanentComponents),
        geocode_provider: "MAPBOX",
        geocode_reference: `mapbox.permanent.${confirmationSource.toLowerCase()}`,
      });
    },
  );

  it("rejects temporary update components at both Core boundaries and finalizes a valid update once", async () => {
    const user = await account();
    const created = await core.createCustomerAddress({
      ...user.request(),
      label: "Home",
      recipient: "Ana",
      phone: "+639171234567",
      latitude: 10.3173,
      longitude: 123.9058,
      components,
      componentsSource: "FIRST_PARTY",
      confirmationSource: "USER_PIN",
      instructions,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const invalidRpc = await core.updateCustomerAddress({
      ...user.request(),
      addressId: created.value.id,
      expectedVersion: created.value.version,
      components: { ...components, addressLine1: "Temporary RPC text" },
      componentsSource: "TEMPORARY_GEOCODER",
      instructions,
    });
    expect(invalidRpc).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const customerId = await customerIdFor(user.userId);
    const invalidDirect = await updateCustomerAddressCommand(env.DB, geocoder(), {
      ...user.request(),
      customerId,
      addressId: created.value.id,
      expectedVersion: created.value.version,
      components: { ...components, addressLine1: "Temporary direct text" },
      componentsSource: "TEMPORARY_GEOCODER",
      instructions,
    });
    expect(invalidDirect).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const beforeValid = await env.DB.prepare(
      "SELECT address_components_json, version FROM customer_address WHERE id=?",
    )
      .bind(created.value.id)
      .first<{ address_components_json: string; version: number }>();
    expect(beforeValid).toEqual({
      address_components_json: JSON.stringify(components),
      version: created.value.version,
    });

    const finalCoordinate = { latitude: 10.319, longitude: 123.907 };
    const permanentComponents = { ...components, addressLine1: "Permanent updated entrance" };
    let reverseCalls = 0;
    const valid = await updateCustomerAddressCommand(
      env.DB,
      geocoder({
        async reversePermanent(input) {
          reverseCalls += 1;
          expect(input.coordinate).toEqual(finalCoordinate);
          return {
            provider: "MAPBOX",
            providerReference: "mapbox.permanent.updated",
            displayAddress: "Permanent updated entrance, Cebu City",
            coordinate: input.coordinate,
            components: permanentComponents,
            accuracy: "rooftop",
          };
        },
      }),
      {
        ...user.request(),
        customerId,
        addressId: created.value.id,
        expectedVersion: created.value.version,
        ...finalCoordinate,
        components: { ...components, addressLine1: "Temporary candidate text" },
        componentsSource: "TEMPORARY_GEOCODER",
        confirmationSource: "USER_PIN",
        instructions,
      },
    );
    expect(reverseCalls).toBe(1);
    expect(valid).toMatchObject({
      ok: true,
      value: { components: permanentComponents, confirmationSource: "USER_PIN" },
    });
  });

  it("preserves an unchanged saved GEOCODER result and only re-finalizes after a move", async () => {
    const user = await account();
    await core.listCustomerAddresses(user.request());
    const customerId = await customerIdFor(user.userId);
    const originalPermanent = { ...components, addressLine1: "Saved geocoder entrance" };
    const created = await createCustomerAddressCommand(
      env.DB,
      geocoder({
        async reversePermanent(input) {
          return {
            provider: "MAPBOX",
            providerReference: "mapbox.permanent.saved-geocoder",
            displayAddress: "Saved geocoder entrance, Cebu City",
            coordinate: input.coordinate,
            components: originalPermanent,
            accuracy: "rooftop",
          };
        },
      }),
      {
        ...user.request(),
        customerId,
        label: "Home",
        recipient: "Ana",
        phone: "+639171234567",
        latitude: 10.3173,
        longitude: 123.9058,
        components,
        componentsSource: "TEMPORARY_GEOCODER",
        confirmationSource: "GEOCODER",
        instructions,
      },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const edited = await updateCustomerAddressCommand(env.DB, geocoder(), {
      ...user.request(),
      customerId,
      addressId: created.value.id,
      expectedVersion: created.value.version,
      recipient: "Ana Updated",
      latitude: created.value.latitude,
      longitude: created.value.longitude,
      components: created.value.components,
      componentsSource: "SAVED_ADDRESS",
      confirmationSource: "GEOCODER",
      instructions,
    });
    expect(edited).toMatchObject({
      ok: true,
      value: { components: originalPermanent, confirmationSource: "GEOCODER" },
    });
    if (!edited.ok) return;
    const retained = await env.DB.prepare(
      "SELECT geocode_provider, geocode_reference, address_components_json FROM customer_address WHERE id=?",
    )
      .bind(edited.value.id)
      .first<{
        geocode_provider: string | null;
        geocode_reference: string | null;
        address_components_json: string;
      }>();
    expect(retained).toEqual({
      geocode_provider: "MAPBOX",
      geocode_reference: "mapbox.permanent.saved-geocoder",
      address_components_json: JSON.stringify(originalPermanent),
    });

    let movedReverseCalls = 0;
    const moved = await updateCustomerAddressCommand(
      env.DB,
      geocoder({
        async reversePermanent(input) {
          movedReverseCalls += 1;
          expect(input.coordinate).toEqual({ latitude: 10.32, longitude: 123.91 });
          return {
            provider: "MAPBOX",
            providerReference: "mapbox.permanent.saved-geocoder-moved",
            displayAddress: "Moved saved entrance, Cebu City",
            coordinate: input.coordinate,
            components: { ...originalPermanent, addressLine1: "Moved saved entrance" },
            accuracy: "rooftop",
          };
        },
      }),
      {
        ...user.request(),
        customerId,
        addressId: edited.value.id,
        expectedVersion: edited.value.version,
        latitude: 10.32,
        longitude: 123.91,
        components: edited.value.components,
        componentsSource: "SAVED_ADDRESS",
        confirmationSource: "USER_PIN",
        instructions,
      },
    );
    expect(movedReverseCalls).toBe(1);
    expect(moved).toMatchObject({
      ok: true,
      value: { components: { addressLine1: "Moved saved entrance" } },
    });
  });

  it("uses saved component provenance for partial confirmed updates", async () => {
    const user = await account();
    await core.listCustomerAddresses(user.request());
    const customerId = await customerIdFor(user.userId);
    const permanentComponents = { ...components, addressLine1: "Partial saved entrance" };
    const created = await createCustomerAddressCommand(
      env.DB,
      geocoder({
        async reversePermanent(input) {
          return {
            provider: "MAPBOX",
            providerReference: "mapbox.permanent.partial-saved",
            displayAddress: "Partial saved entrance, Cebu City",
            coordinate: input.coordinate,
            components: permanentComponents,
            accuracy: "rooftop",
          };
        },
      }),
      {
        ...user.request(),
        customerId,
        label: "Home",
        recipient: "Ana",
        phone: "+639171234567",
        latitude: 10.3173,
        longitude: 123.9058,
        components,
        componentsSource: "TEMPORARY_GEOCODER",
        confirmationSource: "GEOCODER",
        instructions,
      },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const edited = await updateCustomerAddressCommand(env.DB, geocoder(), {
      ...user.request(),
      customerId,
      addressId: created.value.id,
      expectedVersion: created.value.version,
      recipient: "Ana Partial",
      latitude: created.value.latitude,
      longitude: created.value.longitude,
      confirmationSource: "GEOCODER",
    });
    expect(edited).toMatchObject({
      ok: true,
      value: { components: permanentComponents, confirmationSource: "GEOCODER" },
    });
    if (!edited.ok) return;
    const retained = await env.DB.prepare(
      "SELECT address_components_json, geocode_provider, geocode_reference FROM customer_address WHERE id=?",
    )
      .bind(edited.value.id)
      .first<{
        address_components_json: string;
        geocode_provider: string | null;
        geocode_reference: string | null;
      }>();
    expect(retained).toEqual({
      address_components_json: JSON.stringify(permanentComponents),
      geocode_provider: "MAPBOX",
      geocode_reference: "mapbox.permanent.partial-saved",
    });

    let movedReverseCalls = 0;
    const moved = await updateCustomerAddressCommand(
      env.DB,
      geocoder({
        async reversePermanent(input) {
          movedReverseCalls += 1;
          expect(input.coordinate).toEqual({ latitude: 10.32, longitude: 123.91 });
          return {
            provider: "MAPBOX",
            providerReference: "mapbox.permanent.partial-saved-moved",
            displayAddress: "Moved partial saved entrance, Cebu City",
            coordinate: input.coordinate,
            components: { ...permanentComponents, addressLine1: "Moved partial saved entrance" },
            accuracy: "rooftop",
          };
        },
      }),
      {
        ...user.request(),
        customerId,
        addressId: edited.value.id,
        expectedVersion: edited.value.version,
        latitude: 10.32,
        longitude: 123.91,
        confirmationSource: "USER_PIN",
      },
    );
    expect(movedReverseCalls).toBe(1);
    expect(moved).toMatchObject({
      ok: true,
      value: {
        components: { addressLine1: "Moved partial saved entrance" },
        confirmationSource: "USER_PIN",
      },
    });
  });

  it("retains permanent component metadata across saved edits and re-finalizes a later user-pin move", async () => {
    const user = await account();
    await core.listCustomerAddresses(user.request());
    const customerId = await customerIdFor(user.userId);
    const originalPermanent = { ...components, addressLine1: "Original permanent entrance" };
    const created = await createCustomerAddressCommand(
      env.DB,
      geocoder({
        async reversePermanent() {
          return {
            provider: "MAPBOX",
            providerReference: "mapbox.permanent.original",
            displayAddress: "Original permanent entrance, Cebu City",
            coordinate: { latitude: 10.3173, longitude: 123.9058 },
            components: originalPermanent,
            accuracy: "rooftop",
          };
        },
      }),
      {
        ...user.request(),
        customerId,
        label: "Home",
        recipient: "Ana",
        phone: "+639171234567",
        latitude: 10.3173,
        longitude: 123.9058,
        components,
        componentsSource: "TEMPORARY_GEOCODER",
        confirmationSource: "USER_PIN",
        instructions,
      },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const edited = await updateCustomerAddressCommand(env.DB, geocoder(), {
      ...user.request(),
      customerId,
      addressId: created.value.id,
      expectedVersion: created.value.version,
      recipient: "Ana Updated",
      latitude: created.value.latitude,
      longitude: created.value.longitude,
      components: created.value.components,
      componentsSource: "SAVED_ADDRESS",
      confirmationSource: "USER_PIN",
      instructions,
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const retained = await env.DB.prepare(
      "SELECT geocode_provider, geocode_reference FROM customer_address WHERE id=?",
    )
      .bind(edited.value.id)
      .first<{ geocode_provider: string | null; geocode_reference: string | null }>();
    expect(retained).toEqual({
      geocode_provider: "MAPBOX",
      geocode_reference: "mapbox.permanent.original",
    });

    let movedReverseCalls = 0;
    const moved = await updateCustomerAddressCommand(
      env.DB,
      geocoder({
        async reversePermanent(input) {
          movedReverseCalls += 1;
          expect(input.coordinate).toEqual({ latitude: 10.32, longitude: 123.91 });
          return {
            provider: "MAPBOX",
            providerReference: "mapbox.permanent.moved-user-pin",
            displayAddress: "Moved permanent entrance, Cebu City",
            coordinate: input.coordinate,
            components: { ...originalPermanent, addressLine1: "Moved permanent entrance" },
            accuracy: "rooftop",
          };
        },
      }),
      {
        ...user.request(),
        customerId,
        addressId: edited.value.id,
        expectedVersion: edited.value.version,
        latitude: 10.32,
        longitude: 123.91,
        components: edited.value.components,
        componentsSource: "SAVED_ADDRESS",
        confirmationSource: "USER_PIN",
        instructions,
      },
    );
    expect(movedReverseCalls).toBe(1);
    expect(moved).toMatchObject({
      ok: true,
      value: {
        components: { addressLine1: "Moved permanent entrance" },
        confirmationSource: "USER_PIN",
      },
    });
  });

  it("saves a user-positioned pin with structured fields and null provider metadata", async () => {
    const user = await account();
    const created = await core.createCustomerAddress({
      ...user.request(),
      label: "Home",
      recipient: "Ana",
      phone: "+639171234567",
      latitude: 10.3173,
      longitude: 123.9058,
      components,
      componentsSource: "FIRST_PARTY",
      confirmationSource: "USER_PIN",
      instructions,
      addressJson: JSON.stringify({ candidateKey: "temporary-user-pin-candidate" }),
    });
    expect(created).toMatchObject({
      ok: true,
      value: {
        phone: "+639171234567",
        components,
        confirmationSource: "USER_PIN",
        instructions,
        serviceable: true,
      },
    });
    if (!created.ok) return;
    const stored = await env.DB.prepare(
      "SELECT address_json, geocode_provider, geocode_reference, user_confirmed_at FROM customer_address WHERE id=?",
    )
      .bind(created.value.id)
      .first<{
        address_json: string;
        geocode_provider: string | null;
        geocode_reference: string | null;
        user_confirmed_at: number | null;
      }>();
    expect(stored).toMatchObject({ geocode_provider: null, geocode_reference: null });
    expect(stored?.address_json).toBe(JSON.stringify(components));
    expect(stored?.user_confirmed_at).toBeTypeOf("number");
  });

  it("persists an unserviceable structured address as unavailable", async () => {
    const user = await account();
    const created = await core.createCustomerAddress({
      ...user.request(),
      label: "Outside coverage",
      recipient: "Ana",
      phone: "+639171234567",
      latitude: 11,
      longitude: 124,
      components: { ...components, city: "Outside Cebu" },
      componentsSource: "FIRST_PARTY",
      confirmationSource: "DEVICE_LOCATION",
      instructions,
      addressJson: JSON.stringify({ candidateKey: "temporary-device-candidate" }),
    });
    expect(created).toMatchObject({
      ok: true,
      value: {
        status: "active",
        serviceable: false,
        serviceabilityReason: "OUTSIDE_SERVICE_AREA",
      },
    });
    if (!created.ok) return;
    const stored = await env.DB.prepare(
      "SELECT address_json, geocode_provider, geocode_reference FROM customer_address WHERE id=?",
    )
      .bind(created.value.id)
      .first<{
        address_json: string;
        geocode_provider: string | null;
        geocode_reference: string | null;
      }>();
    expect(stored).toEqual({
      address_json: JSON.stringify({ ...components, city: "Outside Cebu" }),
      geocode_provider: null,
      geocode_reference: null,
    });
  });

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
    expect(created.value.serviceable).toBe(true);
    expect(created.value.serviceabilityReason).toBeNull();
  });

  it("persists NO_ELIGIBLE_LOCATION even when area and zone codes resolve", async () => {
    await env.DB.prepare("UPDATE location_capability SET enabled=0").run();
    const user = await account();
    const created = await createAddress(user.request());
    expect(created).toMatchObject({
      ok: true,
      value: {
        serviceAreaCode: "CEBU_CITY",
        deliveryZoneCode: "CEBU_CITY_CORE",
        serviceable: false,
        serviceabilityReason: "NO_ELIGIBLE_LOCATION",
      },
    });
  });

  it("persists an explicit out-of-area resolution", async () => {
    const user = await account();
    const created = await core.createCustomerAddress({
      ...user.request(),
      label: "Out of area",
      recipient: "Recipient",
      phone: "09000000000",
      addressJson: "{}",
      latitude: 11,
      longitude: 124,
    });
    expect(created).toMatchObject({
      ok: true,
      value: {
        serviceable: false,
        serviceabilityReason: "OUTSIDE_SERVICE_AREA",
        serviceAreaCode: null,
        deliveryZoneCode: null,
      },
    });
  });

  it("exposes legacy rows as unresolved rather than inferring serviceability", async () => {
    const user = await account();
    await core.listCustomerAddresses(user.request());
    const customer = await env.DB.prepare(
      "SELECT c.id FROM customer c JOIN customer_principal p ON p.id=c.principal_id WHERE p.auth_user_id=?",
    )
      .bind(user.userId)
      .first<{ id: string }>();
    await env.DB.prepare(
      "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, service_area_code, delivery_zone_code, resolution_version, status, version, created_at, updated_at) VALUES (?, ?, 'Legacy', 'Recipient', '09000000000', '{}', 10.32, 123.9, 'CEBU_CITY', 'CEBU_CITY_CORE', 1, 'active', 1, 0, 0)",
    )
      .bind(crypto.randomUUID(), customer!.id)
      .run();
    const listed = await core.listCustomerAddresses(user.request());
    expect(listed).toMatchObject({
      ok: true,
      value: [{ serviceable: null, serviceabilityReason: null }],
    });
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
    expect(JSON.stringify(forged)).not.toContain(created.value.id);
    expect(JSON.stringify(forged)).not.toContain(owner.userId);
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

  it("rejects partial or unconfirmed structured coordinate edits at the RPC boundary", async () => {
    const user = await account();
    const created = await core.createCustomerAddress({
      ...user.request(),
      label: "Home",
      recipient: "Ana",
      phone: "+639171234567",
      latitude: 10.3173,
      longitude: 123.9058,
      components,
      componentsSource: "FIRST_PARTY",
      confirmationSource: "USER_PIN",
      instructions,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const invalidUpdates = [
      { latitude: 11, confirmationSource: "USER_PIN" },
      { longitude: 124, confirmationSource: "USER_PIN" },
      { latitude: 11, longitude: 124 },
      { confirmationSource: "USER_PIN" },
      {
        latitude: 11,
        longitude: 124,
        addressJson: JSON.stringify({ line1: "Forged legacy exception" }),
      },
    ] as const;
    for (const invalidUpdate of invalidUpdates) {
      const result = await core.updateCustomerAddress({
        ...user.request(),
        addressId: created.value.id,
        expectedVersion: created.value.version,
        ...invalidUpdate,
      });
      expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    }
  });

  it("rejects an unconfirmed structured coordinate edit inside the address application", async () => {
    const user = await account();
    const created = await core.createCustomerAddress({
      ...user.request(),
      label: "Home",
      recipient: "Ana",
      phone: "+639171234567",
      latitude: 10.3173,
      longitude: 123.9058,
      components,
      componentsSource: "FIRST_PARTY",
      confirmationSource: "USER_PIN",
      instructions,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = await updateCustomerAddressCommand(env.DB, geocoder(), {
      ...user.request(),
      customerId: await customerIdFor(user.userId),
      addressId: created.value.id,
      expectedVersion: created.value.version,
      latitude: 11,
      longitude: 124,
      addressJson: JSON.stringify({ line1: "Forged legacy exception" }),
    });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
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
      addressJson: JSON.stringify({ line1: "Outside legacy destination" }),
    });
    expect(moved).toMatchObject({
      ok: true,
      value: {
        latitude: 11,
        longitude: 124,
        serviceAreaCode: null,
        deliveryZoneCode: null,
        serviceable: false,
        serviceabilityReason: "OUTSIDE_SERVICE_AREA",
      },
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
      value: {
        serviceAreaCode: null,
        deliveryZoneCode: null,
        resolutionVersion: null,
        serviceable: false,
        serviceabilityReason: "OUTSIDE_SERVICE_AREA",
      },
    });
  });

  it("permanently re-resolves a geocoder-derived coordinate edit and keeps the pin authoritative", async () => {
    const user = await account();
    const created = await core.createCustomerAddress({
      ...user.request(),
      label: "Home",
      recipient: "Ana",
      phone: "+639171234567",
      latitude: 10.3173,
      longitude: 123.9058,
      components,
      componentsSource: "FIRST_PARTY",
      confirmationSource: "USER_PIN",
      instructions,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const customerId = await customerIdFor(user.userId);
    let reverseCalls = 0;
    const moved = await updateCustomerAddressCommand(
      env.DB,
      geocoder({
        async reversePermanent(input) {
          reverseCalls += 1;
          expect(input.coordinate).toEqual({ latitude: 11, longitude: 124 });
          return {
            provider: "MAPBOX",
            providerReference: "mapbox.permanent.moved",
            displayAddress: "Moved pin",
            coordinate: { latitude: 10.999, longitude: 123.999 },
            components: { ...components, addressLine1: "Moved permanent address" },
            accuracy: null,
          };
        },
      }),
      {
        ...user.request(),
        customerId,
        addressId: created.value.id,
        expectedVersion: created.value.version,
        latitude: 11,
        longitude: 124,
        confirmationSource: "GEOCODER",
      },
    );
    expect(reverseCalls).toBe(1);
    expect(moved).toMatchObject({
      ok: true,
      value: {
        latitude: 11,
        longitude: 124,
        components: { addressLine1: "Moved permanent address" },
        confirmationSource: "GEOCODER",
        serviceable: false,
        status: "active",
      },
    });
  });

  it("searches candidates through the runtime geocoder without logging PII", async () => {
    const sensitiveQuery = "Unit 4B, private family home";
    const sensitiveDisplay = "Unit 4B, Private Family Home, Cebu City";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        features: [
          {
            id: "mapbox.address.private",
            geometry: { type: "Point", coordinates: [123.9058, 10.3173] },
            properties: {
              mapbox_id: "mapbox.address.private",
              feature_type: "address",
              full_address: sensitiveDisplay,
              name: "Private Family Home",
              coordinates: { accuracy: "rooftop" },
              context: {
                address: { name: "Private Family Home" },
                neighborhood: { name: "Luz" },
                place: { name: "Cebu City" },
                region: { name: "Central Visayas" },
                postcode: { name: "6000" },
                country: { name: "Philippines", country_code: "ph" },
              },
            },
          },
        ],
      }),
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const entrypoint = new CoreEntrypoint(
        {} as never,
        {
          DB: env.DB,
          ENVIRONMENT: "test",
          BETTER_AUTH_URL: "https://core.example.invalid",
          TRUSTED_ORIGINS: "https://core.example.invalid",
          PAYMENT_PROVIDER: "mock",
          ROUTE_DISTANCE_PROVIDER: "mock",
          MAPBOX_ACCESS_TOKEN: "test-secret-token",
        } as never,
      );
      const result = await entrypoint.searchAddressCandidates({
        requestId: requestId(),
        query: sensitiveQuery,
      });
      expect(result).toMatchObject({
        ok: true,
        value: [{ displayAddress: sensitiveDisplay, candidateKey: "mapbox.address.private" }],
      });
      expect(fetchSpy).toHaveBeenCalledOnce();
      const logs = logSpy.mock.calls.flat().join(" ");
      expect(logs).not.toContain(sensitiveQuery);
      expect(logs).not.toContain(sensitiveDisplay);
      expect(logs).not.toContain("10.3173");
      expect(logs).not.toContain("123.9058");
      expect(logs).not.toContain("test-secret-token");
    } finally {
      fetchSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it("returns a stable PII-safe geocoder failure from candidate search", async () => {
    const sensitiveQuery = "Private compound beside the blue gate";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 429 }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const entrypoint = new CoreEntrypoint(
        {} as never,
        {
          DB: env.DB,
          ENVIRONMENT: "test",
          BETTER_AUTH_URL: "https://core.example.invalid",
          TRUSTED_ORIGINS: "https://core.example.invalid",
          PAYMENT_PROVIDER: "mock",
          ROUTE_DISTANCE_PROVIDER: "mock",
          MAPBOX_ACCESS_TOKEN: "test-secret-token",
        } as never,
      );
      const result = await entrypoint.searchAddressCandidates({
        requestId: requestId(),
        query: sensitiveQuery,
      });
      expect(result).toMatchObject({ ok: false, error: { code: "GEOCODER_RATE_LIMITED" } });
      const logs = warnSpy.mock.calls.flat().join(" ");
      expect(logs).toContain("GEOCODER_RATE_LIMITED");
      expect(logs).not.toContain(sensitiveQuery);
      expect(logs).not.toContain("test-secret-token");
    } finally {
      fetchSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("never rewrites an immutable committed order address snapshot after an address edit", async () => {
    const user = await account();
    const created = await core.createCustomerAddress({
      ...user.request(),
      label: "Home",
      recipient: "Ana",
      phone: "+639171234567",
      latitude: 10.3173,
      longitude: 123.9058,
      components,
      componentsSource: "FIRST_PARTY",
      confirmationSource: "USER_PIN",
      instructions,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const customerId = await customerIdFor(user.userId);
    const paymentId = `payment-${crypto.randomUUID()}`;
    const orderId = `order-${crypto.randomUUID()}`;
    const snapshot = JSON.stringify(created.value);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO payment_attempt (id, customer_id, amount_minor, currency, status, provider, provider_reference, idempotency_key, created_at, updated_at) VALUES (?, ?, 100, 'PHP', 'SUCCEEDED', 'mock', ?, ?, 0, 0)",
      ).bind(paymentId, customerId, `provider-${paymentId}`, `idempotency-${paymentId}`),
      env.DB.prepare(
        "INSERT INTO grocery_order (id, customer_id, cycle_id, fulfillment_mode, address_snapshot_json, status, total_minor, currency, payment_id, created_at, version) VALUES (?, ?, 'cycle-next-cebu', 'SCHEDULED', ?, 'COMMITTED', 100, 'PHP', ?, 0, 1)",
      ).bind(orderId, customerId, snapshot, paymentId),
    ]);

    const updated = await core.updateCustomerAddress({
      ...user.request(),
      addressId: created.value.id,
      expectedVersion: created.value.version,
      label: "Renamed after commitment",
      instructions: { ...instructions, deliveryNote: "Changed after commitment" },
    });
    expect(updated.ok).toBe(true);
    const storedOrder = await env.DB.prepare(
      "SELECT address_snapshot_json FROM grocery_order WHERE id=?",
    )
      .bind(orderId)
      .first<{ address_snapshot_json: string }>();
    expect(storedOrder?.address_snapshot_json).toBe(snapshot);
  });
});
