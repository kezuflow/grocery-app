import { expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { openDueDeliveryCycles } from "../../commerce/application/open-due-delivery-cycles";
const core = exports.default;
it("routes a confirmed customer address to a new site configured through commands and an opened cycle", async () => {
  const manager = await locationManager();
  // Initial administrator provisioning is the fixture boundary; operational setup below uses commands.
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('delivery.read','delivery.manage','fulfillment.read','fulfillment.manage','staff.read','staff.manage')",
  )
    .bind(manager.id)
    .run();
  const auth = () => ({
    headers: manager.headers,
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  });
  const marketId = "market-metro-cebu",
    name = `New customer site ${crypto.randomUUID()}`;
  const address = {
    addressLine1: "Test dispatch road",
    addressLine2: null,
    barangay: null,
    city: "Cebu",
    region: "Cebu",
    countryCode: "PH",
    postalCode: null,
  };
  const created = await core.createAdminLocation({
    ...auth(),
    marketId,
    code: `site-${crypto.randomUUID()}`,
    name,
    purpose: "CUSTOMER_FULFILLMENT",
    latitude: 10.32,
    longitude: 123.91,
    address,
    capabilities: ["PICKING", "PACKING", "DISPATCH"],
    reason: "Configure customer site",
  });
  if (!created.ok) throw new Error(created.error.message);
  const locationId = created.value.locationId;
  const active = await core.transitionAdminLocation({
    ...auth(),
    locationId,
    expectedVersion: created.value.version,
    action: "ACTIVATE",
    reason: "Confirmed site address and capabilities",
  });
  if (!active.ok) throw new Error(active.error.message);
  expect(
    await core.saveAdminLocationSchedule({
      ...auth(),
      locationId,
      expectedVersion: active.value.version,
      schedule: {
        weekly: Array.from({ length: 7 }, (_, index) => ({
          dayOfWeek: index + 1,
          opensMinute: 0,
          closesMinute: 1440,
        })),
        closures: [],
      },
      reason: "Synthetic staffed schedule",
    }),
  ).toMatchObject({ ok: true });
  expect(
    await core.upsertLocationDeliveryProfile({
      ...auth(),
      locationId,
      senderName: "Dispatch contact",
      phoneE164: "+639171110000",
      email: null,
      formattedAddress: "Test dispatch road, Cebu",
      addressLine1: address.addressLine1,
      city: address.city,
      countryCode: address.countryCode,
      expectedVersion: 0,
    }),
  ).toMatchObject({ ok: true });
  const vertices = [
    { latitude: 10.2, longitude: 123.8 },
    { latitude: 10.2, longitude: 124 },
    { latitude: 10.5, longitude: 124 },
    { latitude: 10.5, longitude: 123.8 },
  ];
  expect(
    await core.publishAdminServiceArea({
      ...auth(),
      marketId,
      code: `area-${crypto.randomUUID()}`,
      name: "New site boundary",
      vertices,
      expectedVersion: 0,
      reason: "Confirm synthetic service area",
    }),
  ).toMatchObject({ ok: true });
  const readiness = await core.getAdminLocationFulfillment({ ...auth(), locationId });
  if (!readiness.ok) throw new Error(readiness.error.message);
  expect(
    await core.configureAdminLocationFulfillment({
      ...auth(),
      locationId,
      expectedVersion: readiness.value.version,
      dispatchReady: true,
      instantPromiseMinutes: null,
      reason: "Scheduled setup complete",
    }),
  ).toMatchObject({ ok: true, value: { dispatchReady: true } });
  const destinations = await core.listAdminCycleDestinations({ ...auth(), marketId });
  if (!destinations.ok) throw new Error(destinations.error.message);
  const destination = destinations.value.items.find((item) => item.locationId === locationId);
  if (!destination) throw new Error("New site missing from cycle destination choices");
  const now = Date.now(),
    at = (hours: number) => new Date(now + hours * 3600000).toISOString();
  const cycle = await core.saveAdminDeliveryCycleDraft({
    ...auth(),
    marketId,
    name: "New site Scheduled cycle",
    expectedVersion: 0,
    orderOpensAt: new Date(now - 1000).toISOString(),
    cutoffAt: at(24),
    procurementAt: at(25),
    preparationAt: at(26),
    pickupAt: at(27),
    windows: [{ name: "Afternoon", startsAt: at(28), endsAt: at(30) }],
    participation: [{ zoneId: destination.zoneId, locationId }],
    reason: "Publish new site schedule",
  });
  if (!cycle.ok) throw new Error(cycle.error.message);
  expect(
    await core.scheduleAdminDeliveryCycle({
      ...auth(),
      cycleId: cycle.value.cycleId,
      expectedVersion: cycle.value.version,
      reason: "Schedule checked",
    }),
  ).toMatchObject({ ok: true });
  expect(await openDueDeliveryCycles(env.DB, Date.now())).toBe(1);
  const customerAddress = await core.createCustomerAddress({
    ...auth(),
    label: "Home",
    recipient: "Customer",
    phone: "+639171234567",
    latitude: 10.32,
    longitude: 123.91,
    components: address,
    componentsSource: "FIRST_PARTY",
    confirmationSource: "USER_PIN",
    instructions: {
      buildingUnit: null,
      landmark: null,
      gateGuard: null,
      deliveryNote: null,
      recipientInstruction: null,
    },
    addressJson: JSON.stringify({ line1: "Test customer entrance" }),
  });
  if (!customerAddress.ok) throw new Error(customerAddress.error.message);
  expect(customerAddress.value.confirmedAt).toBeTruthy();
  expect(
    await core.previewAdminServiceability({
      ...auth(),
      marketId,
      latitude: customerAddress.value.latitude,
      longitude: customerAddress.value.longitude,
    }),
  ).toMatchObject({ ok: true, value: { serviceable: true, locationId, locationName: name } });
  const local = await locationManager("location");
  const staff = await core.getAdminStaff({ ...auth(), staffId: local.id });
  if (!staff.ok) throw new Error(staff.error.message);
  expect(
    await core.setAdminStaffScopes({
      ...auth(),
      staffId: local.id,
      expectedVersion: staff.value.version,
      scopes: [{ kind: "location", locationId }],
    }),
  ).toMatchObject({ ok: true });
  expect(
    await core.listAdminScopes({ headers: local.headers, requestId: crypto.randomUUID() }),
  ).toMatchObject({ ok: true, value: [{ locationId, locationName: name }] });
  expect(
    await env.DB.prepare("SELECT count(*) count FROM inventory_balance WHERE location_id=?")
      .bind(locationId)
      .first(),
  ).toEqual({ count: 0 });
});
