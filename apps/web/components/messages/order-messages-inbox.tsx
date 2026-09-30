"use client";

import Link from "next/link";
import type { OrderConversationView } from "@freshmarkets/contracts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrderMessagesInbox } from "./use-order-messages-inbox";

type Inbox = ReturnType<typeof useOrderMessagesInbox>;

export function OrderMessagesInbox({
  side,
  embedded = false,
  onSelectOrder,
  locationId,
  inbox,
}: {
  side: "CUSTOMER" | "ADMIN";
  embedded?: boolean;
  onSelectOrder?: (orderId: string) => void;
  locationId?: string;
  inbox?: Inbox;
}) {
  const href = side === "ADMIN" ? "/admin/messages" : "/account/messages";
  const ownInbox = useOrderMessagesInbox(side, locationId, !inbox);
  const { items, nextCursor, loading, error, connected, refresh } = inbox ?? ownInbox;

  const content = (
    <>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>
            {side === "ADMIN" ? <h2>Order messages</h2> : <h1>Order messages</h1>}
          </CardTitle>
          {embedded ? null : (
            <>
              <CardDescription>
                {side === "ADMIN"
                  ? "Customer conversations about Orders."
                  : "Conversations about your Orders."}
              </CardDescription>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {connected ? "Live updates connected" : "Live updates are reconnecting"}
              </p>
            </>
          )}
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
        <ul className={embedded ? "flex flex-col divide-y divide-border" : "flex flex-col gap-2"}>
          {items.map((item) => (
            <li key={item.orderId}>
              {embedded && onSelectOrder ? (
                <button
                  type="button"
                  onClick={() => onSelectOrder(item.orderId)}
                  className="fm-conversation-row flex min-h-16 w-full items-center justify-between gap-4 bg-white p-3 text-left outline-none hover:bg-[var(--fm-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--fm-storefront-accent)]"
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
