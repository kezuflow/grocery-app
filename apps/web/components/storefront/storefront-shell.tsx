import Link from "next/link";
import { Search, ShoppingCart } from "lucide-react";
import { AccountPopover } from "./marketplace/account-popover";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { CartIndicator } from "./marketplace/cart-indicator";
import { CartDrawer } from "./marketplace/cart-drawer";
import { mobileNavigation, storefrontNavigation } from "./marketplace/storefront-navigation";
import { ToastAnnouncer } from "./marketplace/toast-announcer";
import { DeliveryAddressDialog } from "./address/delivery-address-dialog";

export { CategoryStrip } from "./marketplace/category-strip";
export { storefrontNavigation } from "./marketplace/storefront-navigation";

export function StorefrontShell({ children }: { children: ReactNode }) {
  return (
    <div className="fm-storefront min-h-[100dvh] bg-[var(--fm-background)] text-[var(--fm-text)]">
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
          className="fm-font-display flex shrink-0 items-center gap-2 text-lg font-bold text-[var(--fm-primary-dark)] lg:text-xl"
        >
          <span
            aria-hidden="true"
            className="inline-block size-6 rounded-[6px] bg-[var(--fm-primary-lime)]"
          />
          freshmarkets
        </Link>
        <form action="/" className="ml-auto hidden min-w-0 flex-1 md:block md:max-w-md">
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
        <DeliveryAddressDialog />
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
    <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-[184px] shrink-0 overflow-y-auto border-r border-[var(--fm-border)] bg-white px-3 py-6 lg:block">
      <nav aria-label="Storefront navigation" className="space-y-1">
        {storefrontNavigation.map((item) => {
          const Icon = item.icon;
          if (item.disabled || !item.href)
            return (
              <button
                key={item.label}
                type="button"
                disabled
                title="Not available yet"
                className="flex min-h-11 w-full cursor-not-allowed items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-2.5 text-left text-sm font-medium text-[var(--fm-text-muted)] opacity-50"
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span>
                  {item.label}
                  <span className="sr-only"> — not available yet</span>
                </span>
              </button>
            );
          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-2.5 text-sm font-medium hover:bg-[var(--fm-hover)]",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
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
        <AccountPopover />
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
      {mobileNavigation.map(({ label, href, icon: Icon }) =>
        label === "Account" ? (
          <AccountPopover key={label} mobile />
        ) : (
          <Link
            key={label}
            href={href}
            className="flex min-h-11 flex-col items-center justify-center gap-1 text-[11px] font-medium text-[var(--fm-text-muted)] hover:text-[var(--fm-primary-dark)]"
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {label}
          </Link>
        ),
      )}
    </nav>
  );
}
