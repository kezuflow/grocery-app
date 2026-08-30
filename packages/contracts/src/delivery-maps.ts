import type { Coordinate, DeliveryInstructions } from "./geography";
import type { AuthenticatedRequest } from "./auth";
import type { DeliveryJobState } from "./states";

export type FulfillmentMode = "INSTANT" | "SCHEDULED";

export type DeliveryMapPin = {
  jobId: string;
  orderId: string;
  batchId: string | null;
  /** Null preserves authorized open rows that have no authoritative map marker. */
  coordinate: Coordinate | null;
  fulfillmentMode: FulfillmentMode;
  cycleId: string | null;
  status: string;
  rider: { riderId: string; displayName: string } | null;
  version: number;
  /** Core-derived eligibility; Web must not reconstruct this policy. */
  selection: { selectable: boolean; reason: string | null };
};

export type DeliveryMapView = {
  locationId: string;
  fulfillmentMode: FulfillmentMode;
  /** Required for Scheduled and null for Instant. */
  cycleId: string | null;
  pins: ReadonlyArray<DeliveryMapPin>;
  /** Opaque continuation for another bounded Core page; null only when complete. */
  nextCursor: string | null;
  /** Explicit completeness evidence; exactly equivalent to nextCursor being null. */
  complete: boolean;
  /** Opaque digest of the complete filtered projection; stable across one traversal. */
  projectionRevision: string;
  /** Authoritative number of entries in the complete filtered projection. */
  totalCount: number;
  generatedAt: string;
};

export type DeliveryMapDetail = {
  jobId: string;
  orderId: string;
  /** Null until the canonical persisted Order number is available to this projection. */
  orderNumber: string | null;
  destination: {
    /** Null when the immutable stop has no authoritative coordinates. */
    coordinate: Coordinate | null;
    displayAddress: string;
    recipient: string;
    phone: string;
    instructions: DeliveryInstructions;
  };
  status: DeliveryJobState;
  version: number;
  /** Core-derived legal operations for the authenticated staff principal. */
  allowedActions: ReadonlyArray<"CREATE_AND_ASSIGN_BATCH">;
};

export type EligibleRiderView = {
  riderId: string;
  displayName: string;
  openBatchCount: number;
  openDeliveryCount: number;
};

export type EligibleRiderPage = {
  riders: ReadonlyArray<EligibleRiderView>;
  /** Opaque continuation for another bounded Core page; null only when complete. */
  nextCursor: string | null;
  /** Explicit completeness evidence; exactly equivalent to nextCursor being null. */
  complete: boolean;
  /** Opaque digest of the complete eligible Rider/workload projection. */
  projectionRevision: string;
  /** Authoritative number of entries in the complete eligible Rider projection. */
  totalCount: number;
};

export type OrderedDeliveryVersion = {
  jobId: string;
  expectedVersion: number;
};

type BatchRouteLeg = { jobId: string; meters: number; seconds: number };

type BatchRouteWarning = {
  code: "ROUTE_NOT_FOUND" | "ROUTE_TIMEOUT" | "ROUTE_UNAVAILABLE" | "ROUTE_INVALID_RESPONSE";
  message: string;
};

/** Preview availability is informational and never authorizes assignment. */
export type BatchRoutePreview =
  | {
      outcome: "AVAILABLE";
      geometry: {
        type: "LineString";
        /** Provider-neutral GeoJSON positions in longitude, latitude order. */
        coordinates: ReadonlyArray<readonly [longitude: number, latitude: number]>;
      };
      totalMeters: number;
      totalSeconds: number;
      legs: ReadonlyArray<BatchRouteLeg>;
      warning: null;
    }
  | {
      outcome: "WARNING";
      geometry: null;
      totalMeters: null;
      totalSeconds: null;
      legs: readonly [];
      warning: BatchRouteWarning;
    };

export type DeliveryBatchView = {
  batchId: string;
  locationId: string;
  fulfillmentMode: FulfillmentMode;
  /** Required for Scheduled and null for Instant. */
  cycleId: string | null;
  status:
    | "DRAFT"
    | "READY"
    | "ASSIGNED"
    | "DISPATCHED"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "CANCELED"
    | "EXCEPTION";
  rider: { riderId: string; displayName: string };
  orderedDeliveries: ReadonlyArray<{
    jobId: string;
    stopId: string;
    sequence: number;
    status: DeliveryJobState;
    version: number;
  }>;
  version: number;
  createdAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
};

/** Immutable assigned-stop projection for the authenticated canonical Rider. */
export type RiderDeliveryView = {
  jobId: string;
  stopId: string;
  orderId: string;
  sequence: number;
  status: DeliveryJobState;
  destination: {
    coordinate: Coordinate | null;
    displayAddress: string;
    recipient: string;
    phone: string;
    instructions: DeliveryInstructions;
  };
  jobVersion: number;
  stopVersion: number;
  /** Legal Rider actions for the current stop; upcoming stops expose none. */
  allowedActions: ReadonlyArray<
    "MARK_EN_ROUTE" | "MARK_ARRIVED" | "MARK_DELIVERED" | "MARK_FAILED"
  >;
};

/** One assigned operational batch in its exact immutable fulfillment context. */
export type RiderBatchView = {
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

export type RiderBatchList = { batches: ReadonlyArray<RiderBatchView> };

type DeliveryDispatchContext = { locationId: string } & (
  | { fulfillmentMode: "INSTANT"; cycleId: null }
  | { fulfillmentMode: "SCHEDULED"; cycleId: string }
);

export type DeliveryMapRequest = AuthenticatedRequest &
  DeliveryDispatchContext & {
    statuses?: ReadonlyArray<DeliveryJobState>;
    riderId?: string | null;
    cursor?: string;
  };

export type DeliveryMapDetailRequest = AuthenticatedRequest &
  DeliveryDispatchContext & {
    jobId: string;
    expectedVersion: number;
  };

export type EligibleRidersRequest = AuthenticatedRequest &
  DeliveryDispatchContext & { cursor?: string };

export type PreviewDeliveryBatchRouteRequest = AuthenticatedRequest &
  DeliveryDispatchContext & {
    /** Manual order only; Core loads every origin/destination coordinate. */
    orderedDeliveries: ReadonlyArray<OrderedDeliveryVersion>;
  };

export type CreateAndAssignDeliveryBatchRequest = AuthenticatedRequest & {
  locationId: string;
  fulfillmentMode: FulfillmentMode;
  /** Required for Scheduled and null for Instant; Core validates this relation. */
  cycleId: string | null;
  /** Canonical Rider identity, never a Better Auth user ID. */
  riderId: string;
  /** One to 24 manually ordered jobs; Core validates bounds and compatibility. */
  orderedDeliveries: ReadonlyArray<OrderedDeliveryVersion>;
  idempotencyKey: string;
};
