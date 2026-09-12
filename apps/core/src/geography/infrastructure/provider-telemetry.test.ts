import { describe, expect, it } from "vitest";
import { observeProviderOperation, type ProviderTelemetryEvent } from "./provider-telemetry";

describe("PII-safe Google Maps provider telemetry", () => {
  it("emits only operation, bounded duration, result, and stable error code", async () => {
    const events: ProviderTelemetryEvent[] = [];
    let time = 100;
    const telemetry = {
      clock: () => (time += 17),
      sink: (event: ProviderTelemetryEvent) => events.push(event),
    };
    await expect(
      observeProviderOperation("GOOGLE_MAPS_ROUTE_DISTANCE", telemetry, async () => {
        throw { code: "ROUTE_NOT_FOUND", privateAddress: "Private Street" };
      }),
    ).rejects.toMatchObject({ code: "ROUTE_NOT_FOUND" });
    expect(events).toEqual([
      {
        operation: "GOOGLE_MAPS_ROUTE_DISTANCE",
        durationMilliseconds: 17,
        result: "FAILURE",
        errorCode: "ROUTE_NOT_FOUND",
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("Private Street");
  });

  it("does not let telemetry failure change provider success", async () => {
    await expect(
      observeProviderOperation(
        "GOOGLE_MAPS_GEOCODER_SEARCH",
        {
          clock: () => 100,
          sink: () => {
            throw new Error("sink unavailable");
          },
        },
        async () => "provider-result",
      ),
    ).resolves.toBe("provider-result");
  });
});
