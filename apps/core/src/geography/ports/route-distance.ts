export type Coordinates = { latitude: number; longitude: number };

export type RouteDistanceResult = {
  distanceMeters: number;
  calculation: { method: "ROAD_ROUTE"; profile: "DRIVING" };
};

export interface RouteDistancePort {
  routeDistance(input: {
    origin: Coordinates;
    destination: Coordinates;
  }): Promise<RouteDistanceResult>;
}
