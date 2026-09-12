"use client";

import Link from "next/link";
import type { AdminDashboardNotification, AdminSelectedScope } from "@freshmarkets/contracts";
import { useAdminContext } from "../../app/admin/admin-context-provider";
import { useAdminOverview } from "../../app/admin/admin-overview-provider";
import {
  NotificationPanel,
  NotificationTimestamp,
  notificationRowClassName,
} from "../notification-panel";

export function AdminNotificationList({
  notifications,
  onSelectScope,
  onNavigate,
  timezone,
}: {
  notifications: readonly AdminDashboardNotification[];
  onSelectScope?: (scope: AdminSelectedScope) => void;
  onNavigate?: () => void;
  timezone?: string;
}) {
  if (!notifications.length)
    return (
      <div role="status" className="p-4 text-sm">
        <p className="font-semibold">No recent notifications</p>
        <p className="mt-1 text-[var(--fm-text-muted)]">
          Updates for your access and selected scope will appear here.
        </p>
      </div>
    );
  return (
    <ul className="divide-y divide-[var(--fm-border)]">
      {notifications.map((notice) => (
        <li key={notice.id}>
          <Link
            href={notice.href}
            prefetch={false}
            className={notificationRowClassName}
            onClick={() => {
              if (notice.scope) onSelectScope?.(notice.scope);
              onNavigate?.();
            }}
          >
            <span className="block break-words font-semibold">{notice.label}</span>
            <span className="mt-0.5 block break-words text-[var(--fm-text-muted)]">
              Order {notice.orderNumber}
            </span>
            <NotificationTimestamp value={notice.occurredAt} timezone={timezone} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AdminNotifications() {
  const { state, selectScope, retry } = useAdminContext();
  const { result, refresh } = useAdminOverview();
  return (
    <NotificationPanel>
      {(close) => {
        if (state.phase === "loading")
          return (
            <p role="status" className="p-4 text-sm">
              Loading notifications…
            </p>
          );
        if (state.phase === "error")
          return (
            <div role="alert" className="p-4 text-sm">
              <p>Notifications are unavailable.</p>
              <button className="min-h-11 underline" onClick={retry}>
                Try again
              </button>
            </div>
          );
        if (state.phase !== "ready")
          return (
            <p role="status" className="p-4 text-sm">
              Notifications are unavailable for your current access.
            </p>
          );
        if (!state.selectedScope)
          return (
            <p role="status" className="p-4 text-sm">
              Select an Admin scope to see notifications.
            </p>
          );
        if (!result)
          return (
            <p role="status" className="p-4 text-sm">
              Loading notifications…
            </p>
          );
        if (!result.ok)
          return (
            <div role="alert" className="p-4 text-sm">
              <p>We couldn’t load your notifications.</p>
              <button className="min-h-11 underline" onClick={refresh}>
                Try again
              </button>
            </div>
          );
        return (
          <>
            <AdminNotificationList
              notifications={result.value.notifications}
              timezone={result.value.timezone}
              onSelectScope={selectScope}
              onNavigate={close}
            />
            <div className="border-t border-[var(--fm-border)] px-4 py-2">
              <Link
                className="inline-flex min-h-11 items-center text-sm font-semibold underline"
                href="/admin#notifications"
                onClick={close}
              >
                View overview
              </Link>
            </div>
          </>
        );
      }}
    </NotificationPanel>
  );
}
