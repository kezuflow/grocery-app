"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OrderConversationView,
  OrderConversationsPage,
  RpcResult,
} from "@freshmarkets/contracts";
import { playInAppNotificationSound } from "@/lib/notifications/in-app-sound";

export const ORDER_MESSAGES_READ_EVENT = "fm:order-messages-read";

export function useOrderMessagesInbox(
  side: "CUSTOMER" | "ADMIN",
  locationId?: string,
  enabled = true,
) {
  const base = side === "ADMIN" ? "/api/admin/messages" : "/api/commerce/messages";
  const [items, setItems] = useState<readonly OrderConversationView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);
  const initialized = useRef(false);
  const known = useRef(new Map<string, { sequence: number; unread: number }>());
  const latestRequest = useRef(0);

  const refresh = useCallback(
    async (cursor?: string) => {
      if (!enabled) return;
      const request = cursor ? null : ++latestRequest.current;
      try {
        const url = new URL(base, window.location.href);
        if (cursor) url.searchParams.set("cursor", cursor);
        if (locationId && side === "ADMIN") url.searchParams.set("locationId", locationId);
        const response = await fetch(url, { cache: "no-store" });
        const result = (await response.json()) as RpcResult<OrderConversationsPage>;
        if (request !== null && request !== latestRequest.current) return;
        if (!result.ok) throw new Error(result.error.message);
        if (!cursor) {
          if (initialized.current) {
            const incoming = result.value.items.find((item) => {
              const previous = known.current.get(item.orderId);
              return (
                item.unreadCount > (previous?.unread ?? 0) &&
                item.lastSequence > (previous?.sequence ?? 0)
              );
            });
            if (incoming)
              void playInAppNotificationSound(
                `message:${incoming.orderId}:${incoming.lastSequence}`,
              );
          }
          for (const item of result.value.items)
            known.current.set(item.orderId, {
              sequence: item.lastSequence,
              unread: item.unreadCount,
            });
          initialized.current = true;
          setItems(result.value.items);
          setTotalUnreadCount(result.value.totalUnreadCount);
        } else {
          setItems((current) => [...current, ...result.value.items]);
        }
        setNextCursor(result.value.nextCursor);
        setError(null);
      } catch (reason) {
        if (request === null || request === latestRequest.current)
          setError(reason instanceof Error ? reason.message : "Messages are unavailable");
      } finally {
        if (request === null || request === latestRequest.current) setLoading(false);
      }
    },
    [base, enabled, locationId, side],
  );

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const onRead = () => void refresh();
    window.addEventListener(ORDER_MESSAGES_READ_EVENT, onRead);
    return () => window.removeEventListener(ORDER_MESSAGES_READ_EVENT, onRead);
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let fallback: number | undefined;
    let delay = 1000;
    const open = () => {
      if (stopped || document.visibilityState !== "visible" || socket) return;
      const url = new URL(`${base}/stream`, window.location.href);
      if (locationId && side === "ADMIN") url.searchParams.set("locationId", locationId);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const next = new WebSocket(url);
      socket = next;
      next.onopen = () => {
        setConnected(true);
        delay = 1000;
        void refresh();
      };
      next.onmessage = (event) => {
        try {
          const hint = JSON.parse(String(event.data)) as { type?: string };
          if (hint.type === "revision") void refresh();
        } catch {
          /* Invalid hint is ignored; focus and fallback recover. */
        }
      };
      next.onclose = () => {
        if (socket === next) socket = null;
        setConnected(false);
        if (!stopped && document.visibilityState === "visible") {
          retry = window.setTimeout(open, delay);
          delay = Math.min(delay * 2, 30_000);
        }
      };
      next.onerror = () => next.close();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        open();
      } else {
        socket?.close();
        socket = null;
        setConnected(false);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    open();
    fallback = window.setInterval(() => {
      if (document.visibilityState === "visible" && !socket) void refresh();
    }, 60_000);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", visibility);
      if (retry) window.clearTimeout(retry);
      if (fallback) window.clearInterval(fallback);
      socket?.close();
    };
  }, [base, enabled, locationId, refresh, side]);

  return { items, nextCursor, loading, error, connected, totalUnreadCount, refresh };
}
