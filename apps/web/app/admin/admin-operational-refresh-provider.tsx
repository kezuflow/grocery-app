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
  /** Shared owner's fetch attempt, including a failed activity read. */
  refreshAttempt: number;
  refreshing: boolean;
  stale: boolean;
  refresh: () => void;
};

const OperationalRefreshContext = createContext<OperationalRefresh | null>(null);
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 300_000;
const DISCONNECTED_FALLBACK_MS = 60_000;
const FAILED_READ_RETRY_MAX_MS = 32_000;
const INERT_OPERATIONAL_REFRESH: OperationalRefresh = {
  enabled: false,
  activity: null,
  revision: 0,
  refreshAttempt: 0,
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
    state.phase === "ready" &&
    state.selectedScope?.kind === "LOCATION" &&
    (state.context.capabilities.includes("fulfillment.read") ||
      state.context.capabilities.includes("delivery.read"))
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
  const initialized = useRef(false);
  const streamConnected = useRef(false);
  const readFailures = useRef(0);
  const noticeIdsByLocation = useRef(new Map<string, string[]>());
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    controller.current?.abort();
    initialized.current = false;
    streamConnected.current = false;
    readFailures.current = 0;
    setActivity(null);
    setStale(false);
  }, [locationId]);

  useEffect(() => {
    if (!locationId) return;
    controller.current?.abort();
    const current = new AbortController();
    let retryTimer = 0;
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
          const newOrders = result.value.notifications.filter(
            (notice) => notice.id.startsWith("order:") && !priorIds.has(notice.id),
          );
          if (newOrders.length === 1)
            toast.info("New paid order", {
              description: `Order ${newOrders[0]!.orderNumber}`,
            });
          if (newOrders.length > 1) toast.info(`${newOrders.length} new paid orders`);
        }
        initialized.current = true;
        readFailures.current = 0;
        const noticeIds = result.value.notifications.map((notice) => notice.id);
        noticeIdsByLocation.current.set(locationId, noticeIds);
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(noticeIds));
        } catch {
          // Session storage is optional; the fetched activity remains authoritative.
        }
        setStale(!streamConnected.current);
        setActivity({ locationId, value: result.value });
        setRevision((value) => value + 1);
      })
      .catch(() => {
        if (!current.signal.aborted) {
          setStale(true);
          const delay = Math.min(
            RECONNECT_BASE_MS * 2 ** readFailures.current,
            FAILED_READ_RETRY_MAX_MS,
          );
          readFailures.current += 1;
          retryTimer = window.setTimeout(() => {
            if (document.visibilityState === "visible") refresh();
          }, delay);
        }
      })
      .finally(() => {
        if (!current.signal.aborted) setRefreshing(false);
      });
    return () => {
      current.abort();
      window.clearTimeout(retryTimer);
    };
    // `attempt` owns refresh scheduling; scope reset is separate so prior data stays mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, attempt]);

  useEffect(() => {
    if (!locationId) return;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let reconnectFailures = 0;
    let lastRevision = 0;
    let disposed = false;
    const connect = () => {
      if (disposed || document.visibilityState !== "visible" || typeof WebSocket === "undefined")
        return;
      if (
        socket &&
        (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
      )
        return;
      const url = new URL("/api/admin/operational-stream", window.location.href);
      url.searchParams.set("locationId", locationId);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const connectedSocket = new WebSocket(url);
      socket = connectedSocket;
      connectedSocket.onopen = () => {
        reconnectFailures = 0;
        streamConnected.current = true;
        setStale(false);
        refresh();
      };
      connectedSocket.onmessage = (event) => {
        try {
          const value: unknown = JSON.parse(String(event.data));
          if (
            !value ||
            typeof value !== "object" ||
            !("revision" in value) ||
            typeof value.revision !== "number" ||
            !Number.isSafeInteger(value.revision) ||
            value.revision <= lastRevision
          )
            return;
          lastRevision = value.revision;
          refresh();
        } catch {
          // An invalid hint cannot authorize or change operational state.
        }
      };
      connectedSocket.onclose = () => {
        if (socket !== connectedSocket) return;
        socket = null;
        streamConnected.current = false;
        if (disposed || document.visibilityState !== "visible") return;
        setStale(true);
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectFailures, RECONNECT_MAX_MS);
        reconnectFailures += 1;
        window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(connect, delay);
      };
      connectedSocket.onerror = () => connectedSocket.close();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
        connect();
      } else {
        window.clearTimeout(reconnectTimer);
        streamConnected.current = false;
        socket?.close();
        socket = null;
      }
    };
    connect();
    const fallbackTimer = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        (typeof WebSocket === "undefined" || socket?.readyState !== WebSocket.OPEN)
      )
        refresh();
    }, DISCONNECTED_FALLBACK_MS);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(fallbackTimer);
      socket?.close();
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [locationId, refresh]);

  return (
    <OperationalRefreshContext.Provider
      value={{
        enabled: true,
        activity: visibleActivity,
        revision,
        refreshAttempt: attempt,
        refreshing,
        stale,
        refresh,
      }}
    >
      {children}
    </OperationalRefreshContext.Provider>
  );
}

export function useAdminOperationalRefresh() {
  const value = useContext(OperationalRefreshContext);
  return value ?? INERT_OPERATIONAL_REFRESH;
}
