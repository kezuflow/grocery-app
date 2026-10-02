import type { AuthenticatedRequest } from "./auth";
import type { Coordinate } from "./geography";

export type AdminDeliveryTrackingRequest = AuthenticatedRequest & {
  locationId: string;
  orderId: string;
};

export type CustomerDeliveryTrackingRequest = AuthenticatedRequest & { orderId: string };

/** Public-safe snapshot. Every position is a provider observation, never a prediction. */
export type DeliveryTrackingView = {
  availability: "NOT_SUPPORTED" | "WAITING" | "LIVE" | "DELAYED" | "UNAVAILABLE" | "FINISHED";
  /** Opaque current dispatch identity; scopes a Web-only last-known rider position. */
  attemptId: string | null;
  destination: Coordinate | null;
  rider: { coordinate: Coordinate; updatedAt: string } | null;
  /** Google suggested road from the last reported rider position, not travel history or an ETA. */
  roadRoute: ReadonlyArray<Coordinate> | null;
  /** Current assigned rider only; null when unavailable, invalidated, or finished. */
  riderContact: { name: string | null; phone: string | null } | null;
  nextRefreshMilliseconds: number | null;
};
