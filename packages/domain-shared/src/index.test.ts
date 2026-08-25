import { describe, expect, it } from "vitest";
import { fixedClock, systemClock } from "./index";

describe("Clock", () => {
  it("returns deterministic copies for tests", () => {
    const clock = fixedClock("2026-01-02T03:04:05.000Z");
    const first = clock.now();
    first.setUTCFullYear(2030);
    expect(clock.now().toISOString()).toBe("2026-01-02T03:04:05.000Z");
  });

  it("provides a system clock", () => {
    expect(systemClock.now()).toBeInstanceOf(Date);
  });
});
