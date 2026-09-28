"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OrderConversationView,
  OrderConversationsPage,
  RpcResult,
} from "@freshmarkets/contracts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { playInAppNotificationSound } from "@/lib/notifications/in-app-sound";

export function OrderMessagesInbox({
  side,
  embedded = false,
  onSelectOrder,
  locationId,
}: {
  side: "CUSTOMER" | "ADMIN";
  embedded?: boolean;
  onSelectOrder?: (orderId: string) => void;
  locationId?: string;
}) {
  const base = side === "ADMIN" ? "/api/admin/messages" : "/api/commerce/messages";
  const href = side === "ADMIN" ? "/admin/messages" : "/account/messages";
  const [items, setItems] = useState<readonly OrderConversationView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const initialized = useRef(false);
  const known = useRef(new Map<string, number>());

  const refresh = useCallback(
    async (cursor?: string) => {
      try {
        const url = new URL(base, window.location.href);
        if (cursor) url.searchParams.set("cursor", cursor);
        if (locationId && side === "ADMIN") url.searchParams.set("locationId", locationId);
        const response = await fetch(url, { cache: "no-store" });
        const result = (await response.json()) as RpcResult<OrderConversationsPage>;
        if (!result.ok) throw new Error(result.error.message);
        if (!cursor) {
          if (initialized.current) {
            const incoming = result.value.items.filter(
              (item) =>
                item.unreadCount > 0 && item.lastSequence > (known.current.get(item.orderId) ?? 0),
            );
            if (incoming.length)
              void playInAppNotificationSound(
                `message:${incoming[0]?.orderId}:${incoming[0]?.lastSequence}`,
              );
          }
          for (const item of result.value.items) known.current.set(item.orderId, item.lastSequence);
          initialized.current = true;
          setItems(result.value.items);
        } else {
          setItems((current) => [...current, ...result.value.items]);
        }
        setNextCursor(result.value.nextCursor);
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Messages are unavailable");
      } finally {
        setLoading(false);
      }
    },
    [base, locationId, side],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
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
  }, [base, locationId, refresh, side]);

  const content = (
    <>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>
            {side === "ADMIN" ? <h2>Order messages</h2> : <h1>Order messages</h1>}
          </CardTitle>
          <CardDescription>
            {side === "ADMIN"
              ? "Customer conversations about Orders."
              : "Conversations about your Orders."}
          </CardDescription>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {connected ? "Live updates connected" : "Live updates are reconnecting"}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void refresh()}>
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading messages…
          </p>
        ) : null}
        {!loading && !items.length ? (
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>No conversations yet. Open an Order to send a message.</p>
            {embedded ? (
              <Link
                href="/orders"
                className="font-medium text-[var(--fm-storefront-accent)] underline"
              >
                View Orders
              </Link>
            ) : null}
          </div>
        ) : null}
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.orderId}>
              {embedded && onSelectOrder ? (
                <button
                  type="button"
                  onClick={() => onSelectOrder(item.orderId)}
                  className="flex min-h-16 w-full items-center justify-between gap-4 rounded-lg border border-border p-3 text-left outline-none hover:border-[var(--fm-storefront-accent)] hover:bg-accent focus-visible:ring-2 focus-visible:ring-[var(--fm-storefront-accent)]"
                >
                  <ConversationSummary item={item} />
                </button>
              ) : (
                <Link
                  href={`${href}/${encodeURIComponent(item.orderId)}`}
                  className="flex min-h-16 items-center justify-between gap-4 rounded-lg border border-border p-3 outline-none hover:border-[var(--fm-storefront-accent)] hover:bg-accent focus-visible:ring-2 focus-visible:ring-[var(--fm-storefront-accent)]"
                >
                  <ConversationSummary item={item} />
                </Link>
              )}
            </li>
          ))}
        </ul>
        {nextCursor ? (
          <Button type="button" variant="outline" onClick={() => void refresh(nextCursor)}>
            Load more
          </Button>
        ) : null}
      </CardContent>
    </>
  );
  return embedded ? (
    <div className="fm-order-messages flex h-full min-h-0 flex-col overflow-y-auto rounded-none border-0 py-3 shadow-none">
      {content}
    </div>
  ) : (
    <Card className="fm-order-messages">{content}</Card>
  );
}

function ConversationSummary({ item }: { item: OrderConversationView }) {
  return (
    <>
      <span className="min-w-0">
        <strong className="block text-sm">Order {item.orderNumber ?? item.orderId}</strong>
        <span className="block truncate text-xs text-muted-foreground">
          {item.latestMessagePreview || "Attachment or expired message"}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {item.unreadCount > 0 ? (
          <Badge className="border-transparent bg-[var(--fm-storefront-accent)] text-white">
            {item.unreadCount} unread
          </Badge>
        ) : null}
        {item.latestMessageAt ? (
          <time className="text-xs text-muted-foreground" dateTime={item.latestMessageAt}>
            {new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" }).format(
              new Date(item.latestMessageAt),
            )}
          </time>
        ) : null}
      </span>
    </>
  );
}
