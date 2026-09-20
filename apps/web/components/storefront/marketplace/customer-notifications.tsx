"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CustomerNotificationsView, RpcResult } from "@freshmarkets/contracts";
import { authClient } from "../../../lib/auth/auth-client";
import { NotificationPanel, notificationRowClassName } from "../../notification-panel";

const READ_STORAGE_PREFIX = "freshmarkets:notification-read:";

function notificationIdentity(item: CustomerNotificationsView["items"][number]) {
  return JSON.stringify([item.type, item.reference, item.occurredAt, item.href]);
}

function readNotificationIdentities(userId: string) {
  try {
    const value = JSON.parse(localStorage.getItem(`${READ_STORAGE_PREFIX}${userId}`) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function markNotificationsRead(userId: string, items: CustomerNotificationsView["items"]) {
  const identities = readNotificationIdentities(userId);
  for (const item of items) identities.add(notificationIdentity(item));
  try {
    localStorage.setItem(
      `${READ_STORAGE_PREFIX}${userId}`,
      JSON.stringify(Array.from(identities).slice(-100)),
    );
  } catch {
    // The current panel still clears for this visit when browser storage is unavailable.
  }
}

export function CustomerNotifications() {
  const { data: session, isPending, error, refetch } = authClient.useSession();
  const userId = session?.user?.id;
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const hasOpenedRef = useRef(false);
  const [result, setResult] = useState<{
    userId: string;
    value: RpcResult<CustomerNotificationsView>;
  } | null>(null);

  useEffect(() => {
    hasOpenedRef.current = false;
  }, [userId]);

  useEffect(() => {
    setUnreadCount(0);
    setResult(null);
    if (!userId || isPending || error) return;
    const controller = new AbortController();
    void fetch("/api/commerce/notifications", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json() as Promise<RpcResult<CustomerNotificationsView>>)
      .then((value) => {
        if (controller.signal.aborted) return;
        setResult({ userId, value });
        if (value.ok) {
          const seen = readNotificationIdentities(userId);
          setUnreadCount(
            value.value.items.filter((item) => !seen.has(notificationIdentity(item))).length,
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({
            userId,
            value: {
              ok: false,
              error: {
                code: "INTERNAL_ERROR",
                message: "Notifications are unavailable.",
                requestId: "unavailable",
              },
            },
          });
      });
    return () => controller.abort();
  }, [userId, isPending, error, attempt]);

  const current = result && result.userId === userId ? result.value : null;
  useEffect(() => {
    if (!open || !userId || !current?.ok) return;
    markNotificationsRead(userId, current.value.items);
    setUnreadCount(0);
  }, [current, open, userId]);

  return (
    <NotificationPanel
      storefront
      unreadCount={unreadCount}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        if (hasOpenedRef.current && current) setAttempt((value) => value + 1);
        hasOpenedRef.current = true;
      }}
    >
      {(close) => (
        <CustomerNotificationContents
          close={close}
          current={current}
          error={error}
          isPending={isPending}
          refetch={refetch}
          retry={() => setAttempt((value) => value + 1)}
          userId={userId}
        />
      )}
    </NotificationPanel>
  );
}

function CustomerNotificationContents({
  close,
  current,
  error,
  isPending,
  refetch,
  retry,
  userId,
}: {
  close: () => void;
  current: RpcResult<CustomerNotificationsView> | null;
  error: Error | null;
  isPending: boolean;
  refetch: () => unknown;
  retry: () => void;
  userId: string | undefined;
}) {
  if (isPending)
    return (
      <p role="status" className="p-4 text-sm">
        Loading your account…
      </p>
    );
  if (error)
    return (
      <div role="alert" className="p-4 text-sm">
        <p>We couldn’t load your account.</p>
        <button className="min-h-11 underline" onClick={() => void refetch()}>
          Try again
        </button>
      </div>
    );
  if (!userId || (current && !current.ok && current.error.code === "UNAUTHENTICATED"))
    return (
      <div className="p-4 text-sm">
        <p>Sign in to see your notifications.</p>
        <Link
          className="mt-2 inline-flex min-h-11 items-center font-semibold underline"
          href="/auth/login?returnTo=/orders"
          onClick={close}
        >
          Sign in
        </Link>
      </div>
    );
  if (!current)
    return (
      <p role="status" className="p-4 text-sm">
        Loading notifications…
      </p>
    );
  if (!current.ok && current.error.code === "FORBIDDEN")
    return (
      <p role="status" className="p-4 text-sm">
        Notifications are unavailable for this account.
      </p>
    );
  if (!current.ok)
    return (
      <div role="alert" className="p-4 text-sm">
        <p>We couldn’t load your notifications.</p>
        <button className="min-h-11 underline" onClick={retry}>
          Try again
        </button>
      </div>
    );
  return (
    <>
      {current.value.items.length > 0 && (
        <p role="status" className="sr-only">
          {current.value.items.length} recent updates loaded.
        </p>
      )}
      {current.value.items.length ? (
        <ul className="divide-y divide-[var(--fm-border)]">
          {current.value.items.map((notice, index) => (
            <li key={`${notice.type}:${notice.occurredAt}:${index}`}>
              <Link
                href={notice.href}
                prefetch={false}
                onClick={close}
                className={notificationRowClassName}
                aria-label={`${notice.label}, ${notice.reference}`}
              >
                <span className="block break-words font-semibold">{notice.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="p-4 text-sm" role="status">
          <p className="font-semibold">No updates yet</p>
        </div>
      )}
      <div className="border-t border-[var(--fm-border)] p-4 text-sm">
        {current.value.hasMore && <p className="sr-only">Showing your latest 24 updates.</p>}
        <Link
          href="/orders"
          onClick={close}
          className="inline-flex min-h-11 items-center font-semibold underline"
        >
          View all orders
        </Link>
      </div>
    </>
  );
}
