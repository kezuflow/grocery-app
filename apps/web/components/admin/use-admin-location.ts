"use client";

import { useSearchParams } from "next/navigation";
import { useAdminContext } from "../../app/admin/admin-context-provider";

/**
 * Selects only a Core-provided location scope. A URL locationId is honored
 * when permitted; otherwise the first permitted location is the safe default.
 */
export function useAdminLocation(): { locationId: string | null; label: string } {
  const { state } = useAdminContext();
  const params = useSearchParams();
  if (state.phase !== "ready") return { locationId: null, label: "Loading permitted location…" };
  const locations = state.scopes.filter(
    (scope): scope is Extract<(typeof state.scopes)[number], { kind: "location" }> =>
      scope.kind === "location",
  );
  const requested = params.get("locationId");
  const selected = locations.find((location) => location.locationId === requested) ?? locations[0];
  return selected
    ? {
        locationId: selected.locationId,
        label: `${selected.locationName} (${selected.locationCode})`,
      }
    : { locationId: null, label: "No permitted fulfillment location" };
}
