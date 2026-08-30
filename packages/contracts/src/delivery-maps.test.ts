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
  RiderBatchList,
  RiderBatchView,
  RiderDeliveryView,
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

type ExpectedDeliveryMapDetail = {
  jobId: string;
  orderId: string;
  orderNumber: string | null;
  destination: {
    coordinate: Coordinate | null;
    displayAddress: string;
    recipient: string;
    phone: string;
    instructions: {
      buildingUnit: string | null;
      landmark: string | null;
      gateGuard: string | null;
      deliveryNote: string | null;
      recipientInstruction: string | null;
    };
  };
  status: import("./states").DeliveryJobState;
  version: number;
  allowedActions: ReadonlyArray<"CREATE_AND_ASSIGN_BATCH">;
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
  it("keeps the rider batch and immutable current-delivery shapes exact", () => {
    type ExpectedRiderDeliveryView = {
      jobId: string;
      stopId: string;
      orderId: string;
      sequence: number;
      status: import("./states").DeliveryJobState;
      destination: {
        coordinate: Coordinate | null;
        displayAddress: string;
        recipient: string;
        phone: string;
        instructions: {
          buildingUnit: string | null;
          landmark: string | null;
          gateGuard: string | null;
          deliveryNote: string | null;
          recipientInstruction: string | null;
        };
      };
      jobVersion: number;
      stopVersion: number;
      allowedActions: ReadonlyArray<
        "MARK_EN_ROUTE" | "MARK_ARRIVED" | "MARK_DELIVERED" | "MARK_FAILED"
      >;
    };
    type ExpectedRiderBatchView = {
      batchId: string;
      locationId: string;
      status: "ASSIGNED" | "DISPATCHED" | "IN_PROGRESS" | "EXCEPTION";
      version: number;
      currentDelivery: RiderDeliveryView | null;
      upcomingDeliveries: ReadonlyArray<RiderDeliveryView>;
    } & (
      | { fulfillmentMode: "INSTANT"; cycleId: null }
      | { fulfillmentMode: "SCHEDULED"; cycleId: string }
    );
    type ExpectedRiderBatchList = { batches: ReadonlyArray<RiderBatchView> };

    type ExactDelivery = Expect<Equal<RiderDeliveryView, ExpectedRiderDeliveryView>>;
    type ExactBatch = Expect<Equal<RiderBatchView, ExpectedRiderBatchView>>;
    type ExactList = Expect<Equal<RiderBatchList, ExpectedRiderBatchList>>;

    void (true as ExactDelivery);
    void (true as ExactBatch);
    void (true as ExactList);
    expect(true).toBe(true);
  });

  it("exposes only immutable rider delivery fields and Core-derived actions", () => {
    const delivery: RiderDeliveryView = {
      jobId: "job-1",
      stopId: "stop-1",
      orderId: "order-1",
      sequence: 2,
      status: "ARRIVED",
      destination: {
        coordinate: { latitude: 10.3157, longitude: 123.8854 },
        displayAddress: "1 Mango Avenue, Cebu City, Cebu, 6000, PH",
        recipient: "Alex D.",
        phone: "+639171234567",
        instructions: {
          buildingUnit: "Unit 2",
          landmark: "Blue gate",
          gateGuard: null,
          deliveryNote: "Call on arrival",
          recipientInstruction: null,
        },
      },
      jobVersion: 7,
      stopVersion: 5,
      allowedActions: ["MARK_DELIVERED", "MARK_FAILED"],
    };
    const batch: RiderBatchView = {
      batchId: "batch-1",
      locationId: "location-1",
      fulfillmentMode: "SCHEDULED",
      cycleId: "cycle-1",
      status: "IN_PROGRESS",
      version: 3,
      currentDelivery: delivery,
      upcomingDeliveries: [{ ...delivery, jobId: "job-2", sequence: 3, allowedActions: [] }],
    };
    const list: RiderBatchList = { batches: [batch] };

    expect(list.batches[0]?.currentDelivery?.jobVersion).toBe(7);
    expect(list.batches[0]?.upcomingDeliveries[0]?.sequence).toBe(3);
    void ({
      ...delivery,
      // @ts-expect-error Rider delivery DTOs never expose raw immutable snapshot JSON.
      addressSnapshotJson: "{}",
    } satisfies RiderDeliveryView);
    void ({
      ...delivery,
      // @ts-expect-error Rider reads never accept or expose authentication user IDs.
      riderAuthUserId: "auth-user-1",
    } satisfies RiderDeliveryView);
  });

  it("keeps the approved pin and ordered command shapes exact", () => {
    type ExactPin = Expect<Equal<DeliveryMapPin, ExpectedDeliveryMapPin>>;
    type ExactDetail = Expect<Equal<DeliveryMapDetail, ExpectedDeliveryMapDetail>>;
    type ExactOrderedDelivery = Expect<
      Equal<OrderedDeliveryVersion, ExpectedOrderedDeliveryVersion>
    >;
    type ExactCommand = Expect<
      Equal<CreateAndAssignDeliveryBatchRequest, ExpectedCreateAndAssignRequest>
    >;

    void (true as ExactPin);
    void (true as ExactDetail);
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
      orderNumber: null,
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
