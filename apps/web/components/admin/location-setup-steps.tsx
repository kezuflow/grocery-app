"use client";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { LocationsWorkspace } from "./locations-workspace";
import { LocationScheduleWorkspace } from "./location-schedule-workspace";
import { LocationDeliveryProfilePanel } from "./delivery/location-delivery-profile-panel";

export function LocationAddressStep(props: ComponentProps<typeof LocationsWorkspace>) {
  const router = useRouter();
  return (
    <LocationsWorkspace
      {...props}
      saveLabel="Save and continue"
      onSaved={(location) =>
        router.push(`/admin/locations/${encodeURIComponent(location.locationId)}/pickup`)
      }
    />
  );
}
export function LocationPickupStep(props: ComponentProps<typeof LocationDeliveryProfilePanel>) {
  const router = useRouter();
  return (
    <LocationDeliveryProfilePanel
      {...props}
      onSaved={() =>
        router.push(`/admin/locations/${encodeURIComponent(props.locationId)}/schedule`)
      }
    />
  );
}
export function LocationHoursStep(props: ComponentProps<typeof LocationScheduleWorkspace>) {
  const router = useRouter();
  return (
    <LocationScheduleWorkspace
      {...props}
      saveLabel="Save and continue"
      onSaved={() =>
        router.push(`/admin/locations/${encodeURIComponent(props.locationId)}/fulfillment`)
      }
    />
  );
}
