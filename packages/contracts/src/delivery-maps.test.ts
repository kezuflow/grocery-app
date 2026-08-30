import { describe, expect, it } from "vitest";
import type { Coordinate } from "./geography";
import type {
  AuthenticatedRequest,
  BatchRoutePreview,
  CreateAndAssignDeliveryBatchRequest,
  DeliveryBatchView,
  DeliveryMapDetail,
  DeliveryMapDetailRequest,
  DeliveryMapPin,
  DeliveryMapRequest,
  DeliveryMapView,
  EligibleRiderView,
  EligibleRidersRequest,
  OrderedDeliveryVersion,
  PreviewDeliveryBatchRouteRequest,
} from "./index";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Type extends true> = Type;

type ExpectedDeliveryMapPin = {
  jobId: string;
  orderId: string;
  batchId: string | null;
  coordinate: Coordinate | null;
  fulfillmentMode: "INSTANT" | "SCHEDULED";
  cycleId: string | null;
  status: string;
  rider: { riderId: string; displayName: string } | null;
  version: number;
  selection: { selectable: boolean; reason: string | null };
};

type ExpectedOrderedDeliveryVersion = { jobId: string; expectedVersion: number };

type ExpectedCreateAndAssignRequest = AuthenticatedRequest & {
  locationId: string;
  fulfillmentMode: "INSTANT" | "SCHEDULED";
  cycleId: string | null;
  riderId: string;
  orderedDeliveries: ReadonlyArray<OrderedDeliveryVersion>;
  idempotencyKey: string;
};

describe("delivery map and atomic dispatch contracts", () => {
  it("keeps the approved pin and ordered command shapes exact", () => {
    type ExactPin = Expect<Equal<DeliveryMapPin, ExpectedDeliveryMapPin>>;
    type ExactOrderedDelivery = Expect<
      Equal<OrderedDeliveryVersion, ExpectedOrderedDeliveryVersion>
    >;
    type ExactCommand = Expect<
      Equal<CreateAndAssignDeliveryBatchRequest, ExpectedCreateAndAssignRequest>
    >;

    void (true as ExactPin);
    void (true as ExactOrderedDelivery);
    void (true as ExactCommand);
    expect(true).toBe(true);
  });

  it("provides bounded map, detail, rider, preview, and batch views", () => {
    const pin: DeliveryMapPin = {
      jobId: "job-1",
      orderId: "order-1",
      batchId: null,
      coordinate: { latitude: 10.3157, longitude: 123.8854 },
      fulfillmentMode: "SCHEDULED",
      cycleId: "cycle-1",
      status: "UNASSIGNED",
      rider: null,
      version: 3,
      selection: { selectable: true, reason: null },
    };
    const map: DeliveryMapView = {
      locationId: "location-1",
      fulfillmentMode: "SCHEDULED",
      cycleId: "cycle-1",
      pins: [pin],
      generatedAt: "2026-08-30T00:00:00.000Z",
    };
    const coordinateMissingPin: DeliveryMapPin = {
      ...pin,
      jobId: "job-missing-coordinate",
      coordinate: null,
      selection: { selectable: false, reason: "MISSING_COORDINATE" },
    };
    const detail: DeliveryMapDetail = {
      jobId: "job-1",
      orderId: "order-1",
      orderNumber: "FM-1001",
      destination: {
        coordinate: pin.coordinate,
        displayAddress: "Cebu City, Cebu",
        recipient: "Alex D.",
        phone: "+639171234567",
        instructions: {
          buildingUnit: "Unit 2",
          landmark: null,
          gateGuard: null,
          deliveryNote: null,
          recipientInstruction: null,
        },
      },
      status: "UNASSIGNED",
      version: 3,
      allowedActions: ["CREATE_AND_ASSIGN_BATCH"],
    };
    const coordinateMissingDetail: DeliveryMapDetail = {
      ...detail,
      jobId: coordinateMissingPin.jobId,
      destination: { ...detail.destination, coordinate: null },
      allowedActions: [],
    };
    const rider: EligibleRiderView = {
      riderId: "rider-1",
      displayName: "Rider One",
      openBatchCount: 1,
      openDeliveryCount: 7,
    };
    const preview: BatchRoutePreview = {
      outcome: "AVAILABLE",
      geometry: {
        type: "LineString",
        coordinates: [
          [123.88, 10.31],
          [123.89, 10.32],
        ],
      },
      totalMeters: 4200,
      totalSeconds: 900,
      legs: [{ jobId: "job-1", meters: 4200, seconds: 900 }],
      warning: null,
    };
    const batch: DeliveryBatchView = {
      batchId: "batch-1",
      locationId: "location-1",
      fulfillmentMode: "SCHEDULED",
      cycleId: "cycle-1",
      status: "ASSIGNED",
      rider: { riderId: "rider-1", displayName: "Rider One" },
      orderedDeliveries: [
        { jobId: "job-1", stopId: "stop-1", sequence: 1, status: "ASSIGNED", version: 4 },
      ],
      version: 1,
      createdAt: "2026-08-30T00:00:00.000Z",
      dispatchedAt: null,
      completedAt: null,
    };

    expect(map.pins).toEqual([pin]);
    expect(coordinateMissingPin.coordinate).toBeNull();
    expect(coordinateMissingDetail.allowedActions).toEqual([]);
    expect(detail.destination.instructions.buildingUnit).toBe("Unit 2");
    expect(rider.openDeliveryCount).toBe(7);
    expect(preview.outcome).toBe("AVAILABLE");
    expect(batch.orderedDeliveries[0]?.sequence).toBe(1);

    void ({
      outcome: "WARNING",
      geometry: null,
      totalMeters: null,
      totalSeconds: null,
      legs: [],
      warning: { code: "ROUTE_TIMEOUT", message: "Preview timed out" },
    } satisfies BatchRoutePreview);
  });

  it("requires authenticated scoped requests and authoritative job versions", () => {
    const auth = { headers: { cookie: "session=opaque" }, requestId: "req-1" } as const;
    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "INSTANT",
      cycleId: null,
      statuses: ["UNASSIGNED"],
      riderId: null,
    } satisfies DeliveryMapRequest);
    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "INSTANT",
      cycleId: null,
      // @ts-expect-error Map filters use the closed Delivery Job state vocabulary.
      statuses: ["PENDING"],
    } satisfies DeliveryMapRequest);
    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "INSTANT",
      cycleId: null,
      jobId: "job-1",
      expectedVersion: 3,
    } satisfies DeliveryMapDetailRequest);
    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "SCHEDULED",
      cycleId: "cycle-1",
    } satisfies EligibleRidersRequest);
    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "SCHEDULED",
      cycleId: "cycle-1",
      orderedDeliveries: [{ jobId: "job-1", expectedVersion: 3 }],
    } satisfies PreviewDeliveryBatchRouteRequest);
    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "SCHEDULED",
      cycleId: "cycle-1",
      riderId: "rider-1",
      orderedDeliveries: [{ jobId: "job-1", expectedVersion: 3 }],
      idempotencyKey: "dispatch-1",
    } satisfies CreateAndAssignDeliveryBatchRequest);

    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "SCHEDULED",
      cycleId: null,
      // @ts-expect-error Scheduled map requests require a cycle identity.
    } satisfies DeliveryMapRequest);
    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "INSTANT",
      cycleId: "cycle-1",
      // @ts-expect-error Instant map requests cannot carry a cycle identity.
    } satisfies DeliveryMapRequest);
    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "SCHEDULED",
      cycleId: null,
      jobId: "job-1",
      expectedVersion: 3,
      // @ts-expect-error Scheduled detail requests require a cycle identity.
    } satisfies DeliveryMapDetailRequest);
    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "INSTANT",
      cycleId: "cycle-1",
      jobId: "job-1",
      expectedVersion: 3,
      // @ts-expect-error Instant detail requests cannot carry a cycle identity.
    } satisfies DeliveryMapDetailRequest);
    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "SCHEDULED",
      cycleId: null,
      // @ts-expect-error Scheduled rider requests require a cycle identity.
    } satisfies EligibleRidersRequest);
    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "INSTANT",
      cycleId: "cycle-1",
      // @ts-expect-error Instant rider requests cannot carry a cycle identity.
    } satisfies EligibleRidersRequest);
    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "SCHEDULED",
      cycleId: null,
      orderedDeliveries: [{ jobId: "job-1", expectedVersion: 3 }],
      // @ts-expect-error Scheduled preview requests require a cycle identity.
    } satisfies PreviewDeliveryBatchRouteRequest);
    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "INSTANT",
      cycleId: "cycle-1",
      orderedDeliveries: [{ jobId: "job-1", expectedVersion: 3 }],
      // @ts-expect-error Instant preview requests cannot carry a cycle identity.
    } satisfies PreviewDeliveryBatchRouteRequest);

    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "SCHEDULED",
      // @ts-expect-error A Scheduled map request cannot omit its cycle context.
    } satisfies DeliveryMapRequest);
    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "INSTANT",
      cycleId: null,
      // @ts-expect-error Route preview requires every selected job's expected version.
      orderedDeliveries: [{ jobId: "job-1" }],
    } satisfies PreviewDeliveryBatchRouteRequest);
    void ({
      ...auth,
      locationId: "location-1",
      fulfillmentMode: "INSTANT",
      cycleId: null,
      riderId: "rider-1",
      orderedDeliveries: [{ jobId: "job-1", expectedVersion: 3 }],
      // @ts-expect-error Atomic assignment requires a caller-stable idempotency key.
    } satisfies CreateAndAssignDeliveryBatchRequest);
  });

  it("rejects client coordinates and raw, provider, or Better Auth payloads", () => {
    void ({
      outcome: "AVAILABLE",
      geometry: null,
      totalMeters: null,
      totalSeconds: null,
      legs: [],
      warning: null,
      // @ts-expect-error An available preview requires provider-neutral geometry and summary.
    } satisfies BatchRoutePreview);
    void ({
      headers: {},
      requestId: "req-1",
      locationId: "location-1",
      fulfillmentMode: "INSTANT",
      cycleId: null,
      orderedDeliveries: [{ jobId: "job-1", expectedVersion: 3 }],
      // @ts-expect-error Preview loads coordinates authoritatively from jobs and fulfillment context.
      coordinates: [{ latitude: 10.31, longitude: 123.88 }],
    } satisfies PreviewDeliveryBatchRouteRequest);
    void ({
      headers: {},
      requestId: "req-1",
      locationId: "location-1",
      fulfillmentMode: "INSTANT",
      cycleId: null,
      riderId: "rider-1",
      orderedDeliveries: [{ jobId: "job-1", expectedVersion: 3 }],
      idempotencyKey: "dispatch-1",
      // @ts-expect-error Assignment accepts canonical rider identity, never an auth user id.
      authUserId: "auth-user-1",
    } satisfies CreateAndAssignDeliveryBatchRequest);
    void ({
      jobId: "job-1",
      orderId: "order-1",
      orderNumber: "FM-1001",
      destination: {
        coordinate: { latitude: 10.31, longitude: 123.88 },
        displayAddress: "Cebu City, Cebu",
        recipient: "Alex D.",
        phone: "+639171234567",
        instructions: {
          buildingUnit: null,
          landmark: null,
          gateGuard: null,
          deliveryNote: null,
          recipientInstruction: null,
        },
      },
      status: "UNASSIGNED",
      version: 3,
      allowedActions: [],
      // @ts-expect-error Details expose a purpose-built destination, not raw snapshot JSON.
      addressSnapshotJson: "{}",
    } satisfies DeliveryMapDetail);
    void ({
      outcome: "WARNING",
      geometry: null,
      totalMeters: null,
      totalSeconds: null,
      legs: [],
      warning: { code: "ROUTE_UNAVAILABLE", message: "Preview unavailable" },
      // @ts-expect-error Route previews never expose provider identity or payloads.
      provider: "mapbox",
    } satisfies BatchRoutePreview);

    expect(true).toBe(true);
  });
});
