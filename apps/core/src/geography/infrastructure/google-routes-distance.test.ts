import { describe, expect, it, vi } from "vitest";
import { GoogleRoutesDistance } from "./google-routes-distance";

const input = {
  origin: { latitude: 10.3157, longitude: 123.8854 },
  destination: { latitude: 10.32, longitude: 123.9 },
};

describe("Google Routes distance", () => {
  it("uses Compute Routes with a field mask and returns road distance", async () => {
    let requestedUrl: RequestInfo | URL | undefined;
    let requestedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = vi.fn(async (url, init) => {
      requestedUrl = url;
      requestedInit = init;
      return Response.json({ routes: [{ distanceMeters: 1_234 }] });
    });
    const adapter = new GoogleRoutesDistance("server-key", fetchImpl);
    await expect(adapter.routeDistance(input)).resolves.toEqual({
      distanceMeters: 1_234,
      calculation: { method: "ROAD_ROUTE", profile: "DRIVING" },
    });
    expect(requestedUrl).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(requestedInit?.method).toBe("POST");
    expect(requestedInit?.headers).toMatchObject({
      "X-Goog-Api-Key": "server-key",
      "X-Goog-FieldMask": "routes.distanceMeters",
    });
    expect(JSON.parse(String(requestedInit?.body))).toMatchObject({ travelMode: "DRIVE" });
  });

  it("distinguishes no route, invalid response, and missing configuration", async () => {
    await expect(
      new GoogleRoutesDistance("server-key", async () =>
        Response.json({ routes: [] }),
      ).routeDistance(input),
    ).rejects.toMatchObject({ code: "ROUTE_NOT_FOUND" });
    await expect(
      new GoogleRoutesDistance("server-key", async () =>
        Response.json({ routes: [{ distanceMeters: -1 }] }),
      ).routeDistance(input),
    ).rejects.toMatchObject({ code: "ROUTE_DISTANCE_INVALID_RESPONSE" });
    await expect(
      new GoogleRoutesDistance("", async () => {
        throw new Error("fetch must not run");
      }).routeDistance(input),
    ).rejects.toMatchObject({ code: "ROUTE_DISTANCE_UNCONFIGURED" });
  });

  it("maps provider deadlines and network failures without accepting fabricated distance", async () => {
    await expect(
      new GoogleRoutesDistance("server-key", async () => {
        throw new DOMException("deadline", "TimeoutError");
      }).routeDistance(input),
    ).rejects.toMatchObject({ code: "ROUTE_DISTANCE_TIMEOUT" });
    await expect(
      new GoogleRoutesDistance("server-key", async () => {
        throw new Error("network unavailable");
      }).routeDistance(input),
    ).rejects.toMatchObject({ code: "ROUTE_DISTANCE_UNAVAILABLE" });
  });

  it("rejects malformed coordinates before calling Google", async () => {
    let called = false;
    const adapter = new GoogleRoutesDistance("server-key", async () => {
      called = true;
      return Response.json({ routes: [] });
    });
    await expect(
      adapter.routeDistance({ ...input, destination: { latitude: Number.NaN, longitude: 123.9 } }),
    ).rejects.toMatchObject({ code: "ROUTE_DISTANCE_INVALID_RESPONSE" });
    expect(called).toBe(false);
  });
});
