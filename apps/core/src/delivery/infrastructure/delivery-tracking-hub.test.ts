import { describe, expect, it } from "vitest";
import { observationAfterLocationError } from "./delivery-tracking-hub";

const previousPosition = {
  coordinate: { latitude: 10.31, longitude: 123.9 },
  updatedAt: "2026-09-29T00:00:00.000Z",
};

describe("delivery tracking provider failure", () => {
  it("drops a former driver's cached coordinate when the driver no longer exists", () => {
    expect(
      observationAfterLocationError("LALAMOVE_HTTP_404", "former-driver", previousPosition),
    ).toEqual({
      driverId: null,
      position: null,
      unavailable: false,
    });
  });

  it("retains a bounded last report for a temporary provider failure", () => {
    expect(
      observationAfterLocationError("LALAMOVE_HTTP_503", "driver-1", previousPosition),
    ).toEqual({
      driverId: "driver-1",
      position: previousPosition,
      unavailable: true,
    });
  });
});
