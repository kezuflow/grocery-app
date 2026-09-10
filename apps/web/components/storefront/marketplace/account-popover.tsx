"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Headphones,
  KeyRound,
  LogOut,
  MapPin,
  ShoppingBag,
  UserRound,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { authClient } from "../../../lib/auth/auth-client";

export function AccountPopover({ mobile = false }: { mobile?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={
          mobile
            ? "flex min-h-11 flex-col items-center justify-center gap-1 text-[11px] font-medium text-[var(--fm-text-muted)] hover:text-[var(--fm-primary-dark)]"
            : "flex min-h-11 w-full items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-2.5 text-sm font-medium hover:bg-[var(--fm-hover)]"
        }
      >
        <UserRound className="size-4" aria-hidden="true" />
        Account
      </PopoverTrigger>
      <PopoverContent
        side={mobile ? "top" : "right"}
        align={mobile ? "end" : "start"}
        sideOffset={12}
        collisionPadding={12}
        aria-label="Account"
        className="fm-storefront w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-[var(--fm-radius-overlay)] border-[var(--fm-border)] bg-white p-0 text-[var(--fm-text)] shadow-[var(--fm-shadow-overlay)]"
        style={{ maxHeight: "var(--radix-popover-content-available-height)" }}
      >
        <div className="px-4 pt-4 pb-2">
          <h2 className="text-base font-bold">Account</h2>
        </div>
        {open && <AccountContents onNavigate={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}

function AccountContents({ onNavigate }: { onNavigate: () => void }) {
  const { data: session, isPending, error, refetch } = authClient.useSession();
  const row =
    "flex min-h-11 items-center gap-3 px-4 py-3 text-sm hover:bg-[var(--fm-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px]";
  return (
    <>
      {isPending ? (
        <p role="status" className="px-4 py-4 text-sm">
          Loading your account…
        </p>
      ) : error ? (
        <div className="px-4 py-3 text-sm" role="alert">
          <p>We couldn’t load your account.</p>
          <button type="button" className="min-h-11 underline" onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <Link
          href={session?.user ? "/account/profile" : "/auth/login?returnTo=/account"}
          onClick={onNavigate}
          className={row}
        >
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--fm-primary-lime)] text-lg font-bold text-[var(--fm-primary-dark)]"
          >
            {session?.user?.name?.trim().charAt(0).toUpperCase() || (
              <UserRound className="size-5" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">
              {session?.user?.name || (session?.user ? "Your account" : "Welcome to FreshMarkets")}
            </span>
            <span className="block text-xs text-[var(--fm-text-muted)]">
              {session?.user ? "View profile" : "Sign in or create an account"}
            </span>
          </span>
        </Link>
      )}
      <nav
        aria-label="Account shortcuts"
        onClick={onNavigate}
        className="border-t border-[var(--fm-border)] py-1"
      >
        <Link href="/orders" className={row}>
          <ShoppingBag className="size-4" aria-hidden="true" />
          Order history
        </Link>
        <Link href="/account/addresses" className={row}>
          <MapPin className="size-4" aria-hidden="true" />
          Delivery addresses
        </Link>
      </nav>
      <nav
        aria-label="Account settings"
        onClick={onNavigate}
        className="border-t border-[var(--fm-border)] py-2"
      >
        <h3 className="px-4 py-2 text-xs font-bold">Account settings</h3>
        <Link href="/account/profile" className={row}>
          Account details
        </Link>
        <Link href="/auth/forgot-password" className={row}>
          <KeyRound className="size-4" aria-hidden="true" />
          Reset password
        </Link>
        <Link href="/staff-invitation" className={row}>
          <BadgeCheck className="size-4" aria-hidden="true" />
          Staff invitation
        </Link>
        <Link href="/account" className={row}>
          All account options
        </Link>
        <a href="mailto:support@freshmarkets.ph" className={row}>
          <Headphones className="size-4" aria-hidden="true" />
          Help and support
        </a>
        {!isPending && !error && session?.user && (
          <Link href="/auth/logout" prefetch={false} className={row}>
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </Link>
        )}
      </nav>
    </>
  );
}
