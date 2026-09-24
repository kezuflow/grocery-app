"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { OperationalActivityView, RpcResult } from "@freshmarkets/contracts";
import { toast } from "sonner";
import { useAdminContext } from "./admin-context-provider";

type OperationalRefresh = {
  enabled: boolean;
  activity: OperationalActivityView | null;
  revision: number;
  refreshing: boolean;
  stale: boolean;
  refresh: () => void;
};

const OperationalRefreshContext = createContext<OperationalRefresh | null>(null);
const BASE_INTERVAL = 8_000;
const MAX_INTERVAL = 32_000;
const INERT_OPERATIONAL_REFRESH: OperationalRefresh = {
  enabled: false,
  activity: null,
  revision: 0,
  refreshing: false,
  stale: false,
  refresh: () => undefined,
};

function storedNoticeIds(key: string): string[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/** One lightweight refresh owner for the currently selected location. */
export function AdminOperationalRefreshProvider({ children }: { children: ReactNode }) {
  const { state } = useAdminContext();
  const locationId =
    state.phase === "ready" && state.selectedScope?.kind === "LOCATION"
      ? state.selectedScope.locationId
      : null;
  const [activity, setActivity] = useState<{
    locationId: string;
    value: OperationalActivityView;
  } | null>(null);
  const visibleActivity = activity?.locationId === locationId ? activity.value : null;
  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);
  const initialized = useRef(false);
  const noticeIdsByLocation = useRef(new Map<string, string[]>());
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    controller.current?.abort();
    initialized.current = false;
    failures.current = 0;
    setActivity(null);
    setStale(false);
  }, [locationId]);

  useEffect(() => {
    if (!locationId) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setRefreshing(true);
    void fetch(`/api/admin/operations-activity?locationId=${encodeURIComponent(locationId)}`, {
      cache: "no-store",
      signal: current.signal,
    })
      .then((response) => response.json() as Promise<RpcResult<OperationalActivityView>>)
      .then((result) => {
        if (current.signal.aborted) return;
        if (!result.ok) throw new Error(result.error.message);
        const storageKey = `freshmarkets.admin.operational-notices:${locationId}`;
        const stored = new Set(
          noticeIdsByLocation.current.get(locationId) ?? storedNoticeIds(storageKey),
        );
        const priorIds = new Set(
          visibleActivity?.notifications.map((notice) => notice.id) ?? stored,
        );
        if (initialized.current) {
          const newOrder = result.value.notifications.find(
            (notice) => notice.id.startsWith("order:") && !priorIds.has(notice.id),
          );
          if (newOrder)
            toast.info("New paid order", { description: `Order ${newOrder.orderNumber}` });
        }
        initialized.current = true;
        const noticeIds = result.value.notifications.map((notice) => notice.id);
        noticeIdsByLocation.current.set(locationId, noticeIds);
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(noticeIds));
        } catch {
          // Session storage is optional; the fetched activity remains authoritative.
        }
        failures.current = 0;
        setStale(false);
        setActivity({ locationId, value: result.value });
        setRevision((value) => value + 1);
      })
      .catch(() => {
        if (!current.signal.aborted) {
          failures.current += 1;
          setStale(true);
        }
      })
      .finally(() => {
        if (!current.signal.aborted) setRefreshing(false);
      });
    return () => current.abort();
    // `attempt` owns refresh scheduling; scope reset is separate so prior data stays mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, attempt]);

  useEffect(() => {
    if (!locationId) return;
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      const delay = Math.min(BASE_INTERVAL * 2 ** failures.current, MAX_INTERVAL);
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") refresh();
        schedule();
      }, delay);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    schedule();
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [locationId, refresh]);

  return (
    <OperationalRefreshContext.Provider
      value={{ enabled: true, activity: visibleActivity, revision, refreshing, stale, refresh }}
    >
      {children}
    </OperationalRefreshContext.Provider>
  );
}

export function useAdminOperationalRefresh() {
  const value = useContext(OperationalRefreshContext);
  return value ?? INERT_OPERATIONAL_REFRESH;
}
