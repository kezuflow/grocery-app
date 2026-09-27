import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { adminCapabilityCodes } from "@freshmarkets/contracts";
import type { Capability } from "@freshmarkets/contracts";
import { RoleCapabilityGroups } from "./role-capability-groups";

const capabilities = adminCapabilityCodes.map((code) => ({ code, description: "Capability" }));

describe("RoleCapabilityGroups", () => {
  it("shows every canonical capability once in a named work area", () => {
    const html = renderToStaticMarkup(
      <RoleCapabilityGroups
        capabilities={capabilities}
        assigned={new Set<Capability>(["staff.read", "inventory.read"])}
        editable
        onToggle={vi.fn()}
      />,
    );

    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(adminCapabilityCodes.length);
    for (const code of adminCapabilityCodes)
      expect(html.split(`>${code}</span>`).length - 1).toBe(1);
    expect(html).toContain("Administrator and setup");
    expect(html).toContain("Fulfillment and stock staff");
    expect(html).toContain("Staff scope assignments determine");
    expect(html).toContain("1 of 7 assigned.");
    expect(html).toContain("1 of 10 assigned.");
  });

  it("keeps archived role capabilities visible but disabled", () => {
    const html = renderToStaticMarkup(
      <RoleCapabilityGroups
        capabilities={capabilities}
        assigned={new Set<Capability>(["staff.read"])}
        editable={false}
        onToggle={vi.fn()}
      />,
    );

    expect((html.match(/type="checkbox"[^>]*disabled=""/g) ?? []).length).toBe(
      adminCapabilityCodes.length,
    );
  });
});
