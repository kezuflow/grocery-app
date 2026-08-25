import { describe, expect, it } from "vitest";
import { can, hasOperationalScope, hasScope } from "./authorization";

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

  it("allows global, location, and market operational scope", () => {
    expect(hasOperationalScope([{ kind: "global" }], "cebu-central", "metro-cebu")).toBe(true);
    expect(
      hasOperationalScope([{ kind: "location", locationId: "cebu-central" }], "cebu-central"),
    ).toBe(true);
    expect(
      hasOperationalScope(
        [{ kind: "market", marketId: "metro-cebu" }],
        "cebu-central",
        "metro-cebu",
      ),
    ).toBe(true);
  });

  it("denies an out-of-scope operational location", () => {
    expect(hasOperationalScope([{ kind: "location", locationId: "mandaue" }], "cebu-central")).toBe(
      false,
    );
    expect(
      hasOperationalScope(
        [{ kind: "market", marketId: "metro-manila" }],
        "cebu-central",
        "metro-cebu",
      ),
    ).toBe(false);
  });
});
