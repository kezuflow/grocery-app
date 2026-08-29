"use client";

import { useAdminContext } from "../../app/admin/admin-context-provider";

/**
 * Returns only the operator's explicit, Core-permitted location selection.
 * It never falls back to the first assignment.
 */
export function useAdminLocation(): { locationId: string | null; label: string } {
  const { state } = useAdminContext();
  if (state.phase !== "ready") return { locationId: null, label: "Loading permitted location…" };
  if (state.selectedScope?.kind !== "LOCATION") {
    return { locationId: null, label: "Select a location scope" };
  }
  const selectedScope = state.selectedScope;
  const selected = state.scopes.find(
    (scope): scope is Extract<(typeof state.scopes)[number], { kind: "location" }> =>
      scope.kind === "location" && scope.locationId === selectedScope.locationId,
  );
  return selected
    ? {
        locationId: selected.locationId,
        label: `${selected.locationName} (${selected.locationCode})`,
      }
    : { locationId: null, label: "No permitted fulfillment location" };
}
