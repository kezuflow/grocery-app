"use client";

import type { AdminSelectedScope } from "@freshmarkets/contracts";
import { ChevronDown, ChevronLeft, ChevronRight, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { adminSelectableScopes, useAdminContext } from "../../app/admin/admin-context-provider";
import { cn } from "../../lib/utils";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { AdminBreadcrumbs } from "./admin-breadcrumbs";
import {
  adminNavigationFromContext,
  groupAdminNavigation,
  mostSpecificActiveNavigation,
  type AdminNavigationEntry,
  type AdminNavigationParent,
} from "./admin-navigation";

const SIDEBAR_PREFERENCE_KEY = "fm-admin-sidebar-collapsed";

function scopeSummary(scopes: ReadonlyArray<{ kind: string }>): string {
  if (scopes.some((scope) => scope.kind === "global")) return "Scope: Global";
  const markets = scopes.filter((scope) => scope.kind === "market").length;
  const locations = scopes.filter((scope) => scope.kind === "location").length;
  const parts: string[] = [];
  if (markets > 0) parts.push(`${markets} market${markets === 1 ? "" : "s"}`);
  if (locations > 0) parts.push(`${locations} location${locations === 1 ? "" : "s"}`);
  return parts.length > 0 ? `Scope: ${parts.join(", ")}` : "Scope: none assigned";
}

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
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const active = mostSpecificActiveNavigation(items, pathname);
  const activeItem = active ? items.find((item) => item.code === active.code) : undefined;
  const parentItem = activeItem?.parentCode
    ? items.find((item) => item.code === activeItem.parentCode)
    : undefined;
  const breadcrumbs = activeItem
    ? [
        ...(activeItem.href === "/admin" ? [] : [{ label: "Admin", href: "/admin" }]),
        ...(parentItem ? [{ label: parentItem.label, href: parentItem.href }] : []),
        { label: activeItem.label },
      ]
    : [{ label: "Admin" }];

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY) === "true");
  }, []);

  function changeCollapsed(next: boolean) {
    setCollapsed(next);
    window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(next));
  }

  return (
    <div className="min-h-screen bg-[var(--fm-admin-canvas)] text-[var(--fm-text)]">
      <AdminHeader items={items} scopeLabel={scopeLabel} environment={environment} />
      <div className="flex w-full">
        <AdminSidebar items={items} collapsed={collapsed} onCollapsedChange={changeCollapsed} />
        <main
          id="main-content"
          aria-labelledby="admin-page-title"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 py-6 outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)] sm:px-6 lg:px-8"
        >
          <div className="mx-auto w-full max-w-[var(--fm-container-admin)] space-y-4">
            <AdminBreadcrumbs items={breadcrumbs} />
            {children}
          </div>
        </main>
      </div>
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
            <span className="hidden font-normal text-[var(--fm-text-muted)] sm:inline">Admin</span>
          </Link>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--fm-text-muted)]">
          <AdminScopeSelector fallbackLabel={scopeLabel} />
          {environment !== "production" ? (
            <span className="hidden rounded-[var(--fm-radius-control)] border border-[var(--fm-warning-border)] bg-[var(--fm-warning-soft)] px-2 py-1 font-semibold uppercase tracking-wide text-[var(--fm-warning)] sm:inline-flex">
              {environment}
            </span>
          ) : null}
          <Link
            href="/"
            className="hidden rounded-[var(--fm-radius-control)] px-2 py-1 font-medium hover:bg-[var(--fm-hover)] sm:inline-flex"
          >
            Marketplace
          </Link>
        </div>
      </div>
    </header>
  );
}

function AdminScopeSelector({ fallbackLabel }: { fallbackLabel: string }) {
  const { state, selectScope } = useAdminContext();
  if (state.phase !== "ready") return <span>{fallbackLabel}</span>;
  const selections: Array<{ value: AdminSelectedScope; label: string }> = adminSelectableScopes(
    state.context,
    state.scopes,
  ).map((scope) => {
    if (scope.kind === "GLOBAL") return { value: scope, label: "Global" };
    if (scope.kind === "MARKET") {
      const option = state.scopes.find(
        (candidate) => candidate.kind === "market" && candidate.marketId === scope.marketId,
      );
      return {
        value: scope,
        label: option?.kind === "market" ? option.marketName : scope.marketId,
      };
    }
    const option = state.scopes.find(
      (candidate) => candidate.kind === "location" && candidate.locationId === scope.locationId,
    );
    return {
      value: scope,
      label: option?.kind === "location" ? option.locationName : scope.locationId,
    };
  });
  return (
    <label className="flex items-center gap-2">
      <span className="hidden sm:inline">Scope</span>
      <select
        aria-label="Active admin scope"
        className="max-w-40 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-2 py-1"
        value={state.selectedScope ? JSON.stringify(state.selectedScope) : ""}
        onChange={(event) => {
          if (event.target.value) selectScope(JSON.parse(event.target.value) as AdminSelectedScope);
        }}
      >
        {state.selectedScope === null ? <option value="">Select scope…</option> : null}
        {selections.map((selection) => {
          const value = JSON.stringify(selection.value);
          return (
            <option key={value} value={value}>
              {selection.label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function AdminMobileMenu({ items }: { items: ReadonlyArray<AdminNavigationEntry> }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const active = mostSpecificActiveNavigation(items, pathname);
  const groups = groupAdminNavigation(items);
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
        aria-label="Admin navigation"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle>Admin navigation</SheetTitle>
        </SheetHeader>
        <nav aria-label="Admin navigation" className="space-y-5">
          {groups.map((group) => (
            <div key={group.code}>
              {group.code !== "overview" ? (
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
                  {group.label}
                </p>
              ) : null}
              <div className="space-y-1">
                {group.items.map((item) => (
                  <MobileNavigationParent key={item.code} item={item} activeCode={active?.code} />
                ))}
              </div>
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

function MobileNavigationParent({
  item,
  activeCode,
}: {
  item: AdminNavigationParent;
  activeCode?: string;
}) {
  const parentActive = activeCode === item.code;
  return (
    <div>
      <SheetClose asChild>
        <Link
          href={item.href}
          aria-current={parentActive ? "page" : undefined}
          className={cn(
            "flex min-h-11 items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-2.5 text-sm font-semibold hover:bg-[var(--fm-hover)]",
            parentActive && "bg-[var(--fm-active)] text-[var(--fm-active-text)]",
          )}
        >
          <item.icon className="size-4" aria-hidden="true" />
          {item.label}
        </Link>
      </SheetClose>
      {item.children.length > 0 ? (
        <div className="ml-8 border-l border-[var(--fm-border)] pl-2">
          {item.children.map((child) => {
            const childActive = activeCode === child.code;
            return (
              <SheetClose key={child.code} asChild>
                <Link
                  href={child.href}
                  aria-current={childActive ? "page" : undefined}
                  className={cn(
                    "block min-h-10 rounded px-3 py-2 text-sm text-[var(--fm-text-muted)] hover:bg-[var(--fm-hover)]",
                    childActive && "bg-[var(--fm-active)] font-medium text-[var(--fm-active-text)]",
                  )}
                >
                  {child.label}
                </Link>
              </SheetClose>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function AdminSidebar({
  items,
  collapsed,
  onCollapsedChange,
}: {
  items: ReadonlyArray<AdminNavigationEntry>;
  collapsed: boolean;
  onCollapsedChange: (next: boolean) => void;
}) {
  const pathname = usePathname();
  const groups = groupAdminNavigation(items);
  const active = mostSpecificActiveNavigation(items, pathname);
  const initiallyOpen = useMemo(
    () =>
      new Set(
        [active?.parentCode, active?.code].filter((value): value is string => Boolean(value)),
      ),
    [active?.code, active?.parentCode],
  );
  const [openParents, setOpenParents] = useState<ReadonlySet<string>>(initiallyOpen);

  useEffect(() => {
    if (!active) return;
    setOpenParents((current) => new Set([...current, active.parentCode ?? active.code]));
  }, [active?.code, active?.parentCode]);

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 border-r border-[var(--fm-border)] bg-white py-4 transition-[width] duration-200 lg:block",
          collapsed
            ? "w-[var(--fm-admin-sidebar-collapsed)] px-2"
            : "w-[var(--fm-admin-sidebar-expanded)] px-3",
        )}
      >
        <nav
          aria-label="Admin navigation"
          className="h-[calc(100%-3rem)] space-y-5 overflow-y-auto overflow-x-visible"
        >
          {groups.map((group) => (
            <div key={group.code}>
              {!collapsed && group.code !== "overview" ? (
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
                  {group.label}
                </p>
              ) : null}
              <div className="space-y-1">
                {group.items.map((item) => (
                  <DesktopNavigationParent
                    key={item.code}
                    item={item}
                    collapsed={collapsed}
                    activeCode={active?.code ?? null}
                    open={openParents.has(item.code)}
                    onToggle={() =>
                      setOpenParents((current) => {
                        const next = new Set(current);
                        if (next.has(item.code)) next.delete(item.code);
                        else next.add(item.code);
                        return next;
                      })
                    }
                  />
                ))}
              </div>
            </div>
          ))}
          {items.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--fm-text-muted)]">
              No workspaces permitted.
            </p>
          ) : null}
        </nav>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={collapsed ? "Expand admin navigation" : "Collapse admin navigation"}
          className={cn("mt-2 w-full", collapsed ? "px-0" : "justify-end")}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <>
              <span className="sr-only">Collapse</span>
              <ChevronLeft className="size-4" />
            </>
          )}
        </Button>
      </aside>
    </TooltipProvider>
  );
}

function DesktopNavigationParent({
  item,
  collapsed,
  activeCode,
  open,
  onToggle,
}: {
  item: AdminNavigationParent;
  collapsed: boolean;
  activeCode: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const parentActive =
    activeCode === item.code || item.children.some((child) => child.code === activeCode);
  if (collapsed) {
    return (
      <div className="group relative">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={item.href}
              aria-label={item.label}
              aria-current={parentActive ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center justify-center rounded-[var(--fm-radius-control)] hover:bg-[var(--fm-hover)]",
                parentActive &&
                  "bg-[var(--fm-admin-accent-soft)] text-[var(--fm-admin-accent-strong)]",
              )}
            >
              <item.icon className="size-5" aria-hidden="true" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
        {item.children.length > 0 ? (
          <div className="invisible absolute left-full top-0 z-40 ml-2 w-52 rounded-lg border border-[var(--fm-border)] bg-white p-2 opacity-0 shadow-[var(--fm-shadow-overlay)] transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
            <p className="px-2 py-1 text-xs font-semibold">{item.label}</p>
            {item.children.map((child) => (
              <Link
                key={child.code}
                href={child.href}
                className="block rounded px-2 py-2 text-sm hover:bg-[var(--fm-hover)]"
              >
                {child.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center gap-1">
        <Link
          href={item.href}
          aria-current={activeCode === item.code ? "page" : undefined}
          className={cn(
            "flex min-h-10 flex-1 items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-2 text-sm font-semibold hover:bg-[var(--fm-hover)]",
            parentActive && "bg-[var(--fm-admin-accent-soft)] text-[var(--fm-admin-accent-strong)]",
          )}
        >
          <item.icon className="size-4" aria-hidden="true" />
          {item.label}
        </Link>
        {item.children.length > 0 ? (
          <button
            type="button"
            aria-label={`${open ? "Collapse" : "Expand"} ${item.label}`}
            aria-expanded={open}
            className="rounded p-2 hover:bg-[var(--fm-hover)] focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)]"
            onClick={onToggle}
          >
            <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} />
          </button>
        ) : null}
      </div>
      {open && item.children.length > 0 ? (
        <div className="ml-5 border-l border-[var(--fm-border)] pl-3">
          {item.children.map((child) => (
            <Link
              key={child.code}
              href={child.href}
              aria-current={activeCode === child.code ? "page" : undefined}
              className={cn(
                "block rounded px-3 py-2 text-sm text-[var(--fm-text-muted)] hover:bg-[var(--fm-hover)]",
                activeCode === child.code && "font-semibold text-[var(--fm-admin-accent-strong)]",
              )}
            >
              {child.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--fm-admin-accent-strong)]">
          FreshMarkets Admin
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
    <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white shadow-[var(--fm-shadow-card)]">
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
