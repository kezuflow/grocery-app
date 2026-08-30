import type { Coordinate } from "@freshmarkets/contracts";

export type RoutePreviewLeg = { meters: number; seconds: number };

export type RoutePreviewResult = {
  geometry: {
    type: "LineString";
    coordinates: ReadonlyArray<readonly [longitude: number, latitude: number]>;
  };
  totalMeters: number;
  totalSeconds: number;
  legs: ReadonlyArray<RoutePreviewLeg>;
};

export type RoutePreviewErrorCode =
  | "ROUTE_UNCONFIGURED"
  | "ROUTE_INVALID_REQUEST"
  | "ROUTE_NOT_FOUND"
  | "ROUTE_TIMEOUT"
  | "ROUTE_UNAVAILABLE"
  | "ROUTE_INVALID_RESPONSE";

export class RoutePreviewError extends Error {
  constructor(readonly code: RoutePreviewErrorCode) {
    super(code);
    this.name = "RoutePreviewError";
  }
}

export interface RoutePreviewPort {
  preview(input: {
    origin: Coordinate;
    orderedDestinations: ReadonlyArray<Coordinate>;
  }): Promise<RoutePreviewResult>;
}
