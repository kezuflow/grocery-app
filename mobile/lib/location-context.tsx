import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ConfirmedBrowsingLocation } from "@freshmarkets/contracts";
import { clearLocation, readLocation, saveLocation } from "./location-store";

type LocationContextValue = {
  location: ConfirmedBrowsingLocation | null;
  ready: boolean;
  selectLocation: (value: ConfirmedBrowsingLocation) => Promise<void>;
  forgetLocation: () => Promise<void>;
};

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<ConfirmedBrowsingLocation | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    void readLocation().then((value) => {
      if (mounted) {
        setLocation(value);
        setReady(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);
  const value = useMemo<LocationContextValue>(
    () => ({
      location,
      ready,
      selectLocation: async (next) => {
        await saveLocation(next);
        setLocation(next);
      },
      forgetLocation: async () => {
        await clearLocation();
        setLocation(null);
      },
    }),
    [location, ready],
  );
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationContextValue {
  const value = useContext(LocationContext);
  if (!value) throw new Error("LocationProvider is missing");
  return value;
}
