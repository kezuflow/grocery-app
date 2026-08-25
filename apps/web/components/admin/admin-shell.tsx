import Link from "next/link";
import {
  Boxes,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  Menu,
  PackageCheck,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  Warehouse,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

const adminNavigation = [
  ["Overview", "/admin", LayoutDashboard],
  ["Orders", "/admin#orders", ClipboardList],
  ["Catalog", "/admin#catalog", Boxes],
  ["Inventory", "/admin#inventory", Warehouse],
  ["Procurement", "/admin#procurement", PackageCheck],
  ["Fulfillment", "/admin#fulfillment", PackageCheck],
  ["Delivery", "/admin#delivery", Truck],
  ["Customers", "/admin#customers", Users],
  ["Subscriptions", "/admin#subscriptions", ShieldCheck],
  ["Payments", "/admin#payments", CreditCard],
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--fm-surface-soft)] text-[var(--fm-text)]">
      <AdminHeader />
      <div className="mx-auto flex w-full max-w-[var(--fm-container-admin)]">
        <AdminSidebar />
        <main className="min-w-0 flex-1 px-4 py-6 pb-20 sm:px-6 lg:px-8 lg:pb-8">{children}</main>
      </div>
      <AdminMobileNav />
    </div>
  );
}

export function AdminHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--fm-border)] bg-white shadow-[var(--fm-shadow-header)]">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <details className="relative lg:hidden">
            <summary
              className="flex cursor-pointer list-none rounded-[var(--fm-radius-control)] p-2 hover:bg-[var(--fm-hover)]"
              aria-label="Open admin navigation"
            >
              <Menu className="size-5" />
            </summary>
            <nav
              aria-label="Expanded admin navigation"
              className="absolute left-0 top-11 z-40 w-64 rounded-[var(--fm-radius-overlay)] border border-[var(--fm-border)] bg-white p-2 shadow-[var(--fm-shadow-overlay)]"
            >
              {adminNavigation.map(([label, href, Icon]) => (
                <Link
                  key={label}
                  href={href}
                  className="flex items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-2.5 text-sm font-medium hover:bg-[var(--fm-hover)]"
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </nav>
          </details>
          <Link
            href="/admin"
            className="text-lg font-bold tracking-[-0.03em] text-[var(--fm-primary-dark)]"
          >
            FreshMarkets{" "}
            <span className="hidden font-normal text-[var(--fm-text-muted)] sm:inline">
              Operations
            </span>
          </Link>
        </div>
        <div className="hidden items-center gap-2 text-xs text-[var(--fm-text-muted)] sm:flex">
          <span className="rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-2 py-1">
            Delivery context
          </span>
          <Link
            href="/"
            className="rounded-[var(--fm-radius-control)] px-2 py-1 font-medium hover:bg-[var(--fm-hover)]"
          >
            Marketplace
          </Link>
        </div>
      </div>
    </header>
  );
}

export function AdminSidebar() {
  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 border-r border-[var(--fm-border)] bg-white px-3 py-5 lg:block">
      <nav aria-label="Admin navigation" className="space-y-1">
        {adminNavigation.map(([label, href, Icon]) => (
          <Link
            key={label}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-2.5 text-sm font-medium hover:bg-[var(--fm-hover)]",
              label === "Overview" && "bg-[var(--fm-surface-soft)] text-[var(--fm-primary-dark)]",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        ))}
        <div className="my-5 border-t border-[var(--fm-border)]" />
        <Link
          href="/admin#audit"
          className="flex items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-2.5 text-sm font-medium hover:bg-[var(--fm-hover)]"
        >
          <ShieldCheck className="size-4" />
          Audit Log
        </Link>
        <Link
          href="/admin#settings"
          className="flex items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-2.5 text-sm font-medium hover:bg-[var(--fm-hover)]"
        >
          <Settings className="size-4" />
          Settings
        </Link>
      </nav>
    </aside>
  );
}

export function AdminMobileNav() {
  return (
    <nav
      aria-label="Mobile admin navigation"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-[var(--fm-border)] bg-white py-2 lg:hidden"
    >
      {adminNavigation.slice(0, 4).map(([label, href, Icon]) => (
        <Link
          key={label}
          href={href}
          className="flex min-h-11 flex-col items-center justify-center gap-1 text-[11px] font-medium text-[var(--fm-text-muted)]"
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-[var(--fm-border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--fm-text-muted)]">
          Operations
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-[var(--fm-text-muted)]">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-3 sm:flex-row sm:flex-wrap sm:items-center">
      {children}
    </div>
  );
}

export function ListPageSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white">
      <div className="border-b border-[var(--fm-border)] px-4 py-3 sm:px-5">
        <h2 className="font-semibold">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-[var(--fm-text-muted)]">{description}</p>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  children: ReactNode;
}) {
  const tones = {
    neutral: "border-[var(--fm-border)] bg-white text-[var(--fm-text-muted)]",
    success:
      "border-[var(--fm-success-border)] bg-[var(--fm-success-soft)] text-[var(--fm-success)]",
    warning:
      "border-[var(--fm-warning-border)] bg-[var(--fm-warning-soft)] text-[var(--fm-warning)]",
    danger:
      "border-[var(--fm-danger-border)] bg-[var(--fm-danger-soft)] text-[var(--fm-destructive)]",
    info: "border-[var(--fm-info-border)] bg-[var(--fm-info-soft)] text-[var(--fm-info)]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--fm-radius-control)] border px-2 py-1 text-xs font-semibold",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
