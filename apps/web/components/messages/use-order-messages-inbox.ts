"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OrderConversationView,
  OrderConversationsPage,
  RpcResult,
} from "@freshmarkets/contracts";
import { playInAppNotificationSound } from "@/lib/notifications/in-app-sound";
import { newOrderMessageSoundIdentities } from "@/lib/notifications/order-message-sound";

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
  const known = useRef(new Map<string, number>());
  const latestObservedAt = useRef(0);
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
          const previouslyObservedAt = latestObservedAt.current;
          for (const item of result.value.items) {
            const previous = known.current.get(item.orderId);
            const latestIncoming = item.recentIncomingSequences.at(-1) ?? 0;
            if (initialized.current && latestIncoming > (previous ?? 0)) {
              const newlyActive =
                previous !== undefined ||
                (item.latestMessageAt !== null &&
                  Date.parse(item.latestMessageAt) >= previouslyObservedAt);
              if (newlyActive) {
                const identities = newOrderMessageSoundIdentities(
                  item.orderId,
                  item.recentIncomingSequences,
                  previous ?? Math.max(0, latestIncoming - 1),
                );
                for (const identity of identities) void playInAppNotificationSound(identity);
              }
            }
            known.current.set(item.orderId, Math.max(previous ?? 0, latestIncoming));
            if (item.latestMessageAt)
              latestObservedAt.current = Math.max(
                latestObservedAt.current,
                Date.parse(item.latestMessageAt),
              );
          }
          initialized.current = true;
          setItems(result.value.items);
          setTotalUnreadCount(result.value.totalUnreadCount);
        } else {
          for (const item of result.value.items)
            known.current.set(item.orderId, item.recentIncomingSequences.at(-1) ?? 0);
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
        if (socket !== next) return;
        socket = null;
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
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", focus);
    open();
    fallback = window.setInterval(() => {
      if (document.visibilityState === "visible" && !socket) void refresh();
    }, 60_000);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", focus);
      if (retry) window.clearTimeout(retry);
      if (fallback) window.clearInterval(fallback);
      socket?.close();
    };
  }, [base, enabled, locationId, refresh, side]);

  return { items, nextCursor, loading, error, connected, totalUnreadCount, refresh };
}
