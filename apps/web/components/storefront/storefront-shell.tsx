import Link from "next/link";
import { ChevronDown, MapPin, Search, ShoppingCart, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { CartIndicator } from "./marketplace/cart-indicator";
import { CartDrawer } from "./marketplace/cart-drawer";
import { mobileNavigation, storefrontNavigation } from "./marketplace/storefront-navigation";
import { ToastAnnouncer } from "./marketplace/toast-announcer";

export { CategoryStrip } from "./marketplace/category-strip";
export { storefrontNavigation } from "./marketplace/storefront-navigation";

export function StorefrontShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[var(--fm-background)] text-[var(--fm-text)]">
      <StorefrontHeader />
      <div className="flex w-full">
        <StorefrontSidebar />
        <main className="min-w-0 flex-1 pb-20 lg:pb-10">{children}</main>
      </div>
      <MobileNavigation />
      <CartDrawer />
      <ToastAnnouncer />
    </div>
  );
}

export function StorefrontHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--fm-border)] bg-white/95 shadow-[var(--fm-shadow-header)] backdrop-blur">
      <div className="flex h-16 w-full items-center gap-3 px-4 sm:px-6 lg:gap-5 lg:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-lg font-bold tracking-[-0.03em] text-[var(--fm-primary-dark)] lg:text-xl"
        >
          <span
            aria-hidden="true"
            className="inline-block size-6 rounded-[6px] bg-[var(--fm-primary-lime)]"
          />
          FreshMarkets
        </Link>
        <form action="/" className="hidden min-w-0 flex-1 md:block">
          <label className="sr-only" htmlFor="storefront-search">
            Search groceries
          </label>
          <div className="flex h-10 items-center gap-2 rounded-full border border-[var(--fm-border)] bg-[var(--fm-surface-soft)] px-3 text-[var(--fm-text-muted)] transition-colors focus-within:border-[var(--fm-primary-dark)]">
            <Search className="size-4" aria-hidden="true" />
            <input
              id="storefront-search"
              name="q"
              placeholder="Search fresh groceries"
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--fm-text)] outline-none placeholder:text-[var(--fm-text-muted)]"
            />
          </div>
        </form>
        <Link
          href="/serviceability"
          className="hidden items-center gap-2 rounded-[var(--fm-radius-control)] px-2 py-2 text-left text-xs hover:bg-[var(--fm-hover)] lg:flex"
          aria-label="Choose delivery address"
        >
          <MapPin className="size-4 text-[var(--fm-primary-dark)]" aria-hidden="true" />
          <span>
            <span className="block text-[10px] text-[var(--fm-text-muted)]">Deliver to</span>
            <span className="flex items-center gap-1 font-semibold">
              Cebu City <ChevronDown className="size-3" aria-hidden="true" />
            </span>
          </span>
        </Link>
        <Link
          href="/account"
          className="hidden rounded-[var(--fm-radius-control)] p-2 hover:bg-[var(--fm-hover)] sm:inline-flex"
          aria-label="Account"
        >
          <UserRound className="size-5" aria-hidden="true" />
        </Link>
        <CartIndicator />
      </div>
      <div className="border-t border-[var(--fm-border)] px-4 py-2 md:hidden">
        <form action="/">
          <label className="sr-only" htmlFor="mobile-storefront-search">
            Search groceries
          </label>
          <div className="flex h-10 items-center gap-2 rounded-full border border-[var(--fm-border)] bg-[var(--fm-surface-soft)] px-3 text-[var(--fm-text-muted)]">
            <Search className="size-4" aria-hidden="true" />
            <input
              id="mobile-storefront-search"
              name="q"
              placeholder="Search fresh groceries"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
        </form>
      </div>
    </header>
  );
}

export function StorefrontSidebar() {
  return (
    <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-52 shrink-0 overflow-y-auto border-r border-[var(--fm-border)] bg-white px-3 py-6 lg:block">
      <nav aria-label="Storefront navigation" className="space-y-1">
        <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--fm-text-muted)]">
          Shop
        </p>
        {storefrontNavigation.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-2.5 text-sm font-medium hover:bg-[var(--fm-hover)]",
                item.label === "Home" &&
                  "bg-[var(--fm-surface-soft)] font-semibold text-[var(--fm-primary-dark)]",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
        <div className="my-5 border-t border-[var(--fm-border)]" />
        <Link
          href="/orders"
          className="flex items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-2.5 text-sm font-medium hover:bg-[var(--fm-hover)]"
        >
          <ShoppingCart className="size-4" aria-hidden="true" />
          Orders
        </Link>
        <Link
          href="/account"
          className="flex items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-2.5 text-sm font-medium hover:bg-[var(--fm-hover)]"
        >
          <UserRound className="size-4" aria-hidden="true" />
          Account
        </Link>
      </nav>
    </aside>
  );
}

export function MobileNavigation() {
  return (
    <nav
      aria-label="Mobile storefront navigation"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-[var(--fm-border)] bg-white/95 py-2 backdrop-blur lg:hidden"
    >
      {mobileNavigation.map(({ label, href, icon: Icon }) => (
        <Link
          key={label}
          href={href}
          className="flex min-h-11 flex-col items-center justify-center gap-1 text-[11px] font-medium text-[var(--fm-text-muted)] hover:text-[var(--fm-primary-dark)]"
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
