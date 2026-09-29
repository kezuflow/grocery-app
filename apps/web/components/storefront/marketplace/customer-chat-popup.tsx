"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Bell, BellOff, MessageCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { OrderMessagesInbox } from "@/components/messages/order-messages-inbox";
import { OrderMessageThread } from "@/components/messages/order-message-thread";
import { useOrderMessagesInbox } from "@/components/messages/use-order-messages-inbox";
import { IconCountBadge } from "@/components/icon-count-badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { authClient } from "@/lib/auth/auth-client";
import {
  notificationSoundMuted,
  setNotificationSoundMuted,
} from "@/lib/notifications/in-app-sound";

function orderIdFromPath(pathname: string) {
  const match = /^\/orders\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function CustomerChatPopup() {
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();
  if (pathname.startsWith("/account/messages")) return null;
  return (
    <CustomerChatPopupContents
      key={session?.user?.id ?? "signed-out"}
      pathname={pathname}
      signedIn={Boolean(session?.user)}
      isPending={isPending}
    />
  );
}

function CustomerChatPopupContents({
  pathname,
  signedIn,
  isPending,
}: {
  pathname: string;
  signedIn: boolean;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const inbox = useOrderMessagesInbox("CUSTOMER", undefined, signedIn && !isPending);

  useEffect(() => setMuted(notificationSoundMuted()), []);

  useEffect(() => {
    setOpen(false);
    setSelectedOrderId(null);
  }, [pathname]);

  const activeOrderId = selectedOrderId ?? orderIdFromPath(pathname);
  const unreadCount = inbox.totalUnreadCount;
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) void inbox.refresh();
        if (!value) setSelectedOrderId(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            unreadCount
              ? `Open order chat, ${unreadCount} unread message${unreadCount === 1 ? "" : "s"}`
              : "Open order chat"
          }
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-3 z-40 flex min-h-12 items-center gap-2 rounded-full bg-[var(--fm-storefront-accent)] px-4 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-[#009944] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fm-storefront-accent)] lg:bottom-5 lg:right-5"
        >
          <MessageCircle className="size-5" aria-hidden="true" />
          Chat
          <IconCountBadge count={unreadCount} className="border-2 border-white" />
        </button>
      </PopoverTrigger>
      <span className="sr-only" role="status" aria-live="polite">
        {unreadCount ? `${unreadCount} unread chat messages` : ""}
      </span>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={12}
        collisionPadding={12}
        aria-label="Order chat"
        className="fm-storefront flex h-[min(70dvh,620px)] max-h-[var(--radix-popover-content-available-height)] w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-[var(--fm-border)] bg-white p-0 text-[var(--fm-text)] shadow-xl"
      >
        <div className="flex min-h-12 items-center gap-2 border-b border-[var(--fm-border)] px-3">
          {activeOrderId && signedIn ? (
            <button
              type="button"
              aria-label="Back to conversations"
              onClick={() => setSelectedOrderId("")}
              className="rounded-full p-1 hover:bg-[var(--fm-hover)]"
            >
              <ArrowLeft className="size-5" aria-hidden="true" />
            </button>
          ) : null}
          <strong className="flex-1 text-sm">Messages</strong>
          {signedIn && !activeOrderId ? (
            <button
              type="button"
              aria-label={muted ? "Turn notification sound on" : "Mute notification sound"}
              onClick={() => {
                setNotificationSoundMuted(!muted);
                setMuted(!muted);
              }}
              className="rounded-full p-1 hover:bg-[var(--fm-hover)]"
            >
              {muted ? (
                <BellOff className="size-5" aria-hidden="true" />
              ) : (
                <Bell className="size-5" aria-hidden="true" />
              )}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Close chat"
            onClick={() => setOpen(false)}
            className="rounded-full p-1 hover:bg-[var(--fm-hover)]"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          {isPending ? (
            <p role="status" className="p-4 text-sm">
              Loading chat…
            </p>
          ) : !signedIn ? (
            <div className="flex flex-col gap-3 p-4 text-sm">
              <p>Sign in to message FreshMarkets about an Order.</p>
              <Link
                href="/auth/login?returnTo=/account/messages"
                className="font-semibold text-[var(--fm-storefront-accent)] underline"
              >
                Sign in
              </Link>
            </div>
          ) : activeOrderId ? (
            <OrderMessageThread
              key={activeOrderId}
              side="CUSTOMER"
              orderId={activeOrderId}
              compact
            />
          ) : (
            <OrderMessagesInbox
              side="CUSTOMER"
              embedded
              onSelectOrder={setSelectedOrderId}
              inbox={inbox}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
