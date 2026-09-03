import { describe, expect, it } from "vitest";
import { normalizePhilippineMobile } from "./customer-phone";

describe("customer phone normalization", () => {
  it.each([
    ["0917 123 4567", "+639171234567"],
    ["0917-123-4567", "+639171234567"],
    ["639171234567", "+639171234567"],
    ["+639171234567", "+639171234567"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizePhilippineMobile(input)).toBe(expected);
  });

  it.each(["9171234567", "0917123456", "+631234", "not-a-phone"])("rejects %s", (input) =>
    expect(normalizePhilippineMobile(input)).toBeNull(),
  );
});
