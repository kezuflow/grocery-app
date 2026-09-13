"use client";
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  z,
  adminLocationsViewSchema,
  adminLocationScheduleViewSchema,
  adminLocationFulfillmentViewSchema,
  locationDeliveryProfileViewSchema,
} from "@freshmarkets/validation";
import type {
  AdminLocationView,
  AdminLocationScheduleView,
  AdminLocationFulfillmentView,
  LocationDeliveryProfileView,
} from "@freshmarkets/contracts";

type SetupData = {
  location: AdminLocationView | null;
  canManage: boolean;
  pickup: LocationDeliveryProfileView | null;
  hours: AdminLocationScheduleView | null;
  readiness: AdminLocationFulfillmentView | null;
};
type SetupState = {
  data: SetupData | null;
  loading: boolean;
  reload: () => void;
  navigationLocked: boolean;
  lockNavigation: () => () => void;
};
const SetupContext = createContext<SetupState | null>(null);
export function useSetupNavigationLock(locked: boolean) {
  const context = useContext(SetupContext);
  const lockNavigation = context?.lockNavigation;
  useEffect(() => {
    if (locked && lockNavigation) return lockNavigation();
  }, [locked, lockNavigation]);
}
export function useLocationSetup() {
  const state = useContext(SetupContext);
  if (!state) throw new Error("Location setup context is required");
  return state;
}
export function LocationSetupProvider({
  locationId,
  children,
}: {
  locationId: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<SetupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [locks, setLocks] = useState(0);
  const lockNavigation = useCallback(() => {
    setLocks((count) => count + 1);
    return () => setLocks((count) => count - 1);
  }, []);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    async function read<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
      try {
        const response = await fetch(
          `/api/admin/${path}?locationId=${encodeURIComponent(locationId)}`,
          {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
          },
        );
        const parsed = z
          .object({ ok: z.literal(true), value: schema })
          .safeParse(await response.json());
        return parsed.success ? parsed.data.value : null;
      } catch {
        return null;
      }
    }
    void Promise.all([
      read("locations", adminLocationsViewSchema),
      read("delivery-location-profile", locationDeliveryProfileViewSchema),
      read("location-schedule", adminLocationScheduleViewSchema),
      read("location-fulfillment", adminLocationFulfillmentViewSchema),
    ]).then(([locations, pickup, hours, readiness]) => {
      if (controller.signal.aborted) return;
      setData({
        location: locations?.items.find((item) => item.locationId === locationId) ?? null,
        canManage: locations?.canManage ?? false,
        pickup,
        hours,
        readiness,
      });
      setLoading(false);
    });
    return () => controller.abort();
  }, [locationId, pathname, revision]);
  return (
    <SetupContext.Provider
      value={{ data, loading, reload, navigationLocked: locks > 0, lockNavigation }}
    >
      {children}
    </SetupContext.Provider>
  );
}
