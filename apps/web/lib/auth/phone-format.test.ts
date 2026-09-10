import { describe, expect, it } from "vitest";
import { formatProfilePhone, normalizeProfilePhone, formatPhoneInput } from "./phone-format";

describe("profile phone presentation", () => {
  it.each([
    ["", ""],
    ["0", "0"],
    ["09", "+63 9"],
    ["0917", "+63 917"],
    ["09171", "+63 917 1"],
    ["09171234", "+63 917 123 4"],
    ["+639171234567", "+63 917 123 4567"],
    ["9171234567", "+63 917 123 4567"],
  ])("formats partial typing %s", (input, expected) => {
    expect(formatPhoneInput(input)).toBe(expected);
  });
  it.each(["0917 123 4567", "639171234567", "+63 (917) 123-4567"])(
    "normalizes supported input %s",
    (input) => {
      expect(normalizeProfilePhone(input)).toBe("+639171234567");
      expect(formatProfilePhone(input)).toBe("+63 917 123 4567");
    },
  );
  it.each(["", "123", "+6391712345678", "0917abc1234567", "+12025550123"])(
    "rejects unsupported input %s without hiding it",
    (input) => {
      expect(normalizeProfilePhone(input)).toBeNull();
      expect(formatProfilePhone(input)).toBe(input);
    },
  );
});
