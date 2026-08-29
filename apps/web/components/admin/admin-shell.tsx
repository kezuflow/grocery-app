"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { adminNavigationFromContext, type AdminNavigationEntry } from "./admin-navigation";
import { useAdminContext } from "../../app/admin/admin-context-provider";
import { Skeleton } from "../ui/skeleton";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "../ui/sheet";
import { cn } from "../../lib/utils";

function scopeSummary(scopes: ReadonlyArray<{ kind: string }>): string {
  if (scopes.some((scope) => scope.kind === "global")) return "Scope: Global";
  const markets = scopes.filter((scope) => scope.kind === "market").length;
  const locations = scopes.filter((scope) => scope.kind === "location").length;
  const parts: string[] = [];
  if (markets > 0) parts.push(`${markets} market${markets === 1 ? "" : "s"}`);
  if (locations > 0) parts.push(`${locations} location${locations === 1 ? "" : "s"}`);
  return parts.length > 0 ? `Scope: ${parts.join(", ")}` : "Scope: none assigned";
}

/**
 * Shell chrome consuming only Core-provided navigation items and the explicit
 * scope summary. No permission is inferred here; unauthorized workspaces are
 * absent because Core never returned them.
 */
export function AdminShell({
  children,
  items,
  scopeLabel,
  environment,
}: {
  children: ReactNode;
  items: ReadonlyArray<AdminNavigationEntry>;
  scopeLabel: string;
  environment: string;
}) {
  return (
    <div className="min-h-screen bg-[var(--fm-surface-soft)] text-[var(--fm-text)]">
      <AdminHeader items={items} scopeLabel={scopeLabel} environment={environment} />
      <div className="mx-auto flex w-full max-w-[var(--fm-container-admin)]">
        <AdminSidebar items={items} />
        <main
          id="main-content"
          aria-labelledby="admin-page-title"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 py-6 pb-20 outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)] sm:px-6 lg:px-8 lg:pb-8"
        >
          {children}
        </main>
      </div>
      <AdminMobileNav items={items} />
    </div>
  );
}

function AdminHeader({
  items,
  scopeLabel,
  environment,
}: {
  items: ReadonlyArray<AdminNavigationEntry>;
  scopeLabel: string;
  environment: string;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--fm-border)] bg-white shadow-[var(--fm-shadow-header)]">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <AdminMobileMenu items={items} />
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
            {scopeLabel}
          </span>
          {environment !== "production" ? (
            <span className="rounded-[var(--fm-radius-control)] border border-[var(--fm-warning-border)] bg-[var(--fm-warning-soft)] px-2 py-1 font-semibold uppercase tracking-wide text-[var(--fm-warning)]">
              {environment}
            </span>
          ) : null}
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

function AdminMobileMenu({ items }: { items: ReadonlyArray<AdminNavigationEntry> }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Sheet>
      <SheetTrigger
        ref={triggerRef}
        aria-label="Open admin navigation"
        className="rounded-[var(--fm-radius-control)] p-2 hover:bg-[var(--fm-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)] lg:hidden"
      >
        <Menu className="size-5" />
      </SheetTrigger>
      <SheetContent
        side="left"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle>Admin navigation</SheetTitle>
        </SheetHeader>
        <nav aria-label="Admin navigation" className="space-y-1">
          {items.map((item) => (
            <Link
              key={item.code}
              href={item.href}
              className="flex items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-2.5 text-sm font-medium hover:bg-[var(--fm-hover)]"
            >
              <item.icon className="size-4" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

function AdminSidebar({ items }: { items: ReadonlyArray<AdminNavigationEntry> }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 border-r border-[var(--fm-border)] bg-white px-3 py-5 lg:block">
      <nav aria-label="Admin navigation" className="space-y-1">
        {items.map((item) => (
          <Link
            key={item.code}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-2.5 text-sm font-medium hover:bg-[var(--fm-hover)]",
              isActivePath(pathname, item.href) &&
                "bg-[var(--fm-surface-soft)] text-[var(--fm-primary-dark)]",
            )}
            aria-current={isActivePath(pathname, item.href) ? "page" : undefined}
          >
            <item.icon className="size-4" aria-hidden="true" />
            {item.label}
          </Link>
        ))}
        {items.length === 0 ? (
          <p className="px-3 py-2 text-xs text-[var(--fm-text-muted)]">No workspaces permitted.</p>
        ) : null}
      </nav>
    </aside>
  );
}

function AdminMobileNav({ items }: { items: ReadonlyArray<AdminNavigationEntry> }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Mobile admin navigation"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-[var(--fm-border)] bg-white py-2 lg:hidden"
    >
      {items.slice(0, 4).map((item) => (
        <Link
          key={item.code}
          href={item.href}
          className="flex min-h-11 flex-col items-center justify-center gap-1 text-[11px] font-medium text-[var(--fm-text-muted)]"
          aria-current={isActivePath(pathname, item.href) ? "page" : undefined}
        >
          <item.icon className="size-4" aria-hidden="true" />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function isActivePath(pathname: string | null, href: string): boolean {
  return pathname === href || (href !== "/admin" && pathname?.startsWith(`${href}/`) === true);
}

/**
 * Boundary between the Core-derived context and the shell: renders the
 * loading/unauthenticated/forbidden/error states and only mounts the shell
 * with Core-provided navigation once the context is ready.
 */
export function AdminShellBoundary({ children }: { children: ReactNode }) {
  const { state, retry } = useAdminContext();
  if (state.phase === "loading") {
    return (
      <main
        className="min-h-screen bg-[var(--fm-surface-soft)] p-4 sm:p-6 lg:p-8"
        role="status"
        aria-label="Loading admin shell"
      >
        <Skeleton className="h-16 w-full" />
        <div className="mt-6 flex gap-6">
          <Skeleton className="hidden h-72 w-60 lg:block" />
          <div className="flex-1 space-y-4">
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
      </main>
    );
  }
  if (state.phase === "unauthenticated") {
    return (
      <main className="mx-auto max-w-2xl p-6" aria-labelledby="admin-page-title">
        <Alert>
          <h1 id="admin-page-title" className="font-semibold leading-none">
            Sign in required
          </h1>
          <AlertDescription>
            Sign in with a staff account to open the admin workspace.{" "}
            <Link href="/login" className="font-medium underline">
              Go to sign in
            </Link>
          </AlertDescription>
        </Alert>
      </main>
    );
  }
  if (state.phase === "forbidden") {
    return (
      <main className="mx-auto max-w-2xl p-6" aria-labelledby="admin-page-title">
        <Alert variant="warning">
          <h1 id="admin-page-title" className="font-semibold leading-none">
            Staff access required
          </h1>
          <AlertDescription>
            This account is not an active staff principal. Ask an administrator for the roles and
            scopes your work requires.
          </AlertDescription>
        </Alert>
      </main>
    );
  }
  if (state.phase === "error") {
    return (
      <main className="mx-auto max-w-2xl p-6" aria-labelledby="admin-page-title">
        <Alert variant="destructive">
          <h1 id="admin-page-title" className="font-semibold leading-none">
            The admin workspace could not be loaded
          </h1>
          <AlertDescription>
            {state.message}
            {state.requestId ? (
              <>
                <br />
                <span className="font-mono text-xs">Request reference: {state.requestId}</span>
              </>
            ) : null}
            <br />
            <Button className="mt-3" size="sm" variant="outline" onClick={retry}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </main>
    );
  }
  return (
    <AdminShell
      items={adminNavigationFromContext(state.context.navigation)}
      scopeLabel={scopeSummary(state.context.scopes)}
      environment={state.context.environment}
    >
      {children}
    </AdminShell>
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
        <h1
          id="admin-page-title"
          className="mt-1 text-2xl font-bold tracking-[-0.02em] sm:text-3xl"
        >
          {title}
        </h1>
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
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center rounded-[var(--fm-radius-control)] border px-2 py-1 text-xs font-semibold",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
