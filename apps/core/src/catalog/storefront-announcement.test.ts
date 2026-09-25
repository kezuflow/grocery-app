import { describe, expect, it } from "vitest";
import { supportsMondayFridaySundayCopy } from "./storefront-announcement";

describe("storefront announcement schedule", () => {
  const mondayToSunday = {
    orderOpensAt: Date.parse("2026-09-20T16:00:00.000Z"), // Monday 00:00 Manila
    cutoffAt: Date.parse("2026-09-25T15:59:00.000Z"), // Friday 23:59 Manila
    startsAt: Date.parse("2026-09-27T02:00:00.000Z"), // Sunday 10:00 Manila
    endsAt: Date.parse("2026-09-27T10:00:00.000Z"), // Sunday 18:00 Manila
    timezone: "Asia/Manila",
  };

  it("permits the weekly wording only for Monday-Friday orders and Sunday arrival", () => {
    expect(supportsMondayFridaySundayCopy(mondayToSunday)).toBe(true);
    expect(
      supportsMondayFridaySundayCopy({
        ...mondayToSunday,
        startsAt: Date.parse("2026-09-26T02:00:00.000Z"),
      }),
    ).toBe(false);
    expect(
      supportsMondayFridaySundayCopy({
        ...mondayToSunday,
        cutoffAt: Date.parse("2026-09-26T15:59:00.000Z"),
      }),
    ).toBe(false);
  });
});
