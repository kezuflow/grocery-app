import { describe, expect, it } from "vitest";
import { coordinatesConfirmed } from "./geocoding";

describe("coordinate confirmation policy", () => {
  it("requires an explicit valid user confirmation time", () => {
    expect(coordinatesConfirmed(null)).toBe(false);
    expect(coordinatesConfirmed({ source: "USER_PIN", userConfirmedAt: new Date("invalid") })).toBe(
      false,
    );
    expect(coordinatesConfirmed({ source: "USER_PIN", userConfirmedAt: new Date(0) })).toBe(true);
  });
});
