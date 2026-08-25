import { describe, expect, it } from "vitest";
import { can, hasScope } from "./authorization";

describe("application authorization", () => {
  it("keeps authentication separate from capabilities", () => {
    expect(can([], "staff:read")).toBe(false);
    expect(can(["staff:read"], "staff:read")).toBe(true);
  });

  it("accepts global scope and exact scoped access", () => {
    expect(hasScope([{ kind: "global" }], { kind: "location", locationId: "cebu-central" })).toBe(
      true,
    );
    expect(
      hasScope([{ kind: "location", locationId: "cebu-central" }], {
        kind: "location",
        locationId: "cebu-central",
      }),
    ).toBe(true);
    expect(
      hasScope([{ kind: "location", locationId: "cebu-central" }], {
        kind: "location",
        locationId: "mandaue",
      }),
    ).toBe(false);
  });
});
