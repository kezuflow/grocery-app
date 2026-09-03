import { describe, expect, it } from "vitest";
import { splitContactName } from "./delivery-contact";

describe("delivery contact normalization", () => {
  it("preserves the complete customer name across Grab's name fields", () => {
    expect(splitContactName("  Ana Maria Santos ")).toEqual({
      firstName: "Ana",
      lastName: "Maria Santos",
    });
  });
});
