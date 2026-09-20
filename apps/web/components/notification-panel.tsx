"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Bell, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { IconCountBadge } from "./icon-count-badge";

/** Shared overlay behavior only; each surface owns its data and design tokens. */
export function NotificationPanel({
  storefront = false,
  unreadCount = 0,
  onOpenChange,
  children,
}: {
  storefront?: boolean;
  unreadCount?: number;
  onOpenChange?: (open: boolean) => void;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  function changeOpen(next: boolean) {
    openRef.current = next;
    setOpen(next);
    onOpenChange?.(next);
  }
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // A rapid reopen can retain Radix's focus scope instead of mounting it
    // again, so mount autofocus alone does not cover every open transition.
    if (open) (storefront ? titleRef.current : closeRef.current)?.focus();
  }, [open, storefront]);
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger
        ref={triggerRef}
        aria-label={
          unreadCount ? `Open notifications, ${unreadCount} unread` : "Open notifications"
        }
        className="inline-flex size-12 shrink-0 items-center justify-center rounded-full text-[var(--fm-text)] hover:bg-[var(--fm-hover)] focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span className="relative inline-flex">
          <Bell className="size-6" aria-hidden="true" />
          <IconCountBadge count={unreadCount} />
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        aria-labelledby={titleId}
        aria-describedby={storefront ? undefined : descriptionId}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (storefront ? titleRef.current : closeRef.current)?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // Radix restores focus asynchronously; a previous close must not
          // steal focus from a panel the user has already reopened.
          if (!openRef.current) triggerRef.current?.focus();
        }}
        className={`${storefront ? "fm-storefront" : "fm-admin"} flex w-96 max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0 data-[state=open]:animate-none data-[state=closed]:animate-none`}
        style={{ maxHeight: "min(640px, var(--radix-popover-content-available-height))" }}
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--fm-border)] py-2 pl-4 pr-2">
          <div className="py-2">
            <h2
              ref={titleRef}
              tabIndex={-1}
              id={titleId}
              className="text-base font-semibold outline-none"
            >
              Notifications
            </h2>
            {!storefront && (
              <p id={descriptionId} className="mt-1 text-xs text-[var(--fm-text-muted)]">
                Recent updates in your selected scope
              </p>
            )}
          </div>
          {!storefront && (
            <button
              ref={closeRef}
              type="button"
              aria-label="Close notifications"
              onClick={() => changeOpen(false)}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-[var(--fm-hover)] focus-visible:outline-2"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {open && children(() => changeOpen(false))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const notificationRowClassName =
  "block min-h-11 px-4 py-3 text-sm hover:bg-[var(--fm-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px]";

export function NotificationTimestamp({ value, timezone }: { value: string; timezone?: string }) {
  return (
    <time dateTime={value} className="mt-1 block text-xs font-normal text-[var(--fm-text-muted)]">
      {new Date(value).toLocaleString("en-PH", {
        timeZone: timezone,
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}
    </time>
  );
}
