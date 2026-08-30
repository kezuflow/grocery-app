import type { Coordinate, DeliveryInstructions } from "./geography";
import type { AuthenticatedRequest } from "./index";
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
  generatedAt: string;
};

export type DeliveryMapDetail = {
  jobId: string;
  orderId: string;
  orderNumber: string;
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

type DeliveryDispatchContext = { locationId: string } & (
  | { fulfillmentMode: "INSTANT"; cycleId: null }
  | { fulfillmentMode: "SCHEDULED"; cycleId: string }
);

export type DeliveryMapRequest = AuthenticatedRequest &
  DeliveryDispatchContext & {
    statuses?: ReadonlyArray<DeliveryJobState>;
    riderId?: string | null;
  };

export type DeliveryMapDetailRequest = AuthenticatedRequest &
  DeliveryDispatchContext & {
    jobId: string;
    expectedVersion: number;
  };

export type EligibleRidersRequest = AuthenticatedRequest & DeliveryDispatchContext;

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
