"use client";

import type { AdminSelectedScope } from "@freshmarkets/contracts";
import {
  Bell,
  ChevronDown,
  ChevronsUpDown,
  LoaderCircle,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sprout,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { adminSelectableScopes, useAdminContext } from "../../app/admin/admin-context-provider";
import { cn } from "../../lib/utils";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../ui/select";
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
import { useAdminTheme } from "./admin-theme-provider";
import {
  adminNavigationFromContext,
  adminNavigationItemsForScope,
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
  const [collapsed, setCollapsed] = useState(true);
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
  const showBreadcrumbs =
    ![
      "/admin/catalog/products",
      "/admin/catalog/products/new",
      "/admin/catalog/categories",
      "/admin/catalog/categories/new",
      "/admin/orders",
      "/admin/issues",
      "/admin/customers",
      "/admin/memberships",
    ].includes(pathname) &&
    !pathname.startsWith("/admin/orders/") &&
    !pathname.startsWith("/admin/issues/");

  useEffect(() => {
    const savedPreference = window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY);
    setCollapsed(savedPreference === null ? true : savedPreference === "true");
  }, []);

  function changeCollapsed(next: boolean) {
    setCollapsed(next);
    window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(next));
  }

  return (
    <div className="flex min-h-screen bg-[var(--fm-admin-canvas)] text-[var(--fm-text)]">
      <AdminSidebar items={items} collapsed={collapsed} onCollapsedChange={changeCollapsed} />
      <div
        className={cn(
          "min-w-0 flex-1 bg-[var(--fm-admin-content)] md:my-2 md:mr-2 md:overflow-clip md:rounded-xl md:shadow-[var(--fm-shadow-shell)]",
          collapsed && "md:ml-2",
        )}
      >
        <AdminHeader
          items={items}
          scopeLabel={scopeLabel}
          environment={environment}
          collapsed={collapsed}
          onCollapsedChange={changeCollapsed}
        />
        <main
          id="main-content"
          aria-labelledby="admin-page-title"
          tabIndex={-1}
          className="min-w-0 flex-1 bg-[var(--fm-admin-content)] px-4 py-6 outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)] sm:px-6 lg:px-8"
        >
          <div className="mx-auto w-full max-w-[var(--fm-container-admin)] space-y-4">
            {showBreadcrumbs ? <AdminBreadcrumbs items={breadcrumbs} /> : null}
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
  collapsed,
  onCollapsedChange,
}: {
  items: ReadonlyArray<AdminNavigationEntry>;
  scopeLabel: string;
  environment: string;
  collapsed: boolean;
  onCollapsedChange: (next: boolean) => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--fm-border)] bg-[var(--fm-admin-content)]/90 backdrop-blur-md md:rounded-t-xl">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <AdminMobileMenu items={items} />
          <Link
            href="/admin"
            prefetch={false}
            aria-label="freshmarkets admin home"
            className="flex h-9 select-none items-center gap-2 rounded-lg text-[var(--fm-text)] hover:bg-[var(--fm-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)] md:hidden"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--fm-admin-accent)] text-white shadow-sm">
              <Sprout className="size-4.5" aria-hidden="true" />
            </span>
            <span className="truncate pr-1 text-sm font-semibold tracking-[-0.02em]">
              freshmarkets
            </span>
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={collapsed ? "Expand admin navigation" : "Collapse admin navigation"}
            className="hidden size-9 rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] shadow-sm hover:bg-[var(--fm-admin-surface-muted)] md:inline-flex"
            onClick={() => onCollapsedChange(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-4" aria-hidden="true" />
            )}
          </Button>
          <AdminScopeSelector fallbackLabel={scopeLabel} />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--fm-text-muted)]">
          {environment !== "production" ? (
            <span className="hidden rounded-[var(--fm-radius-control)] border border-[var(--fm-warning-border)] bg-[var(--fm-warning-soft)] px-2 py-1 font-semibold uppercase tracking-wide text-[var(--fm-warning)] sm:inline-flex">
              {environment}
            </span>
          ) : null}
          <Link
            href="/"
            prefetch={false}
            className="hidden rounded-[var(--fm-radius-control)] px-2 py-1 font-medium hover:bg-[var(--fm-hover)] sm:inline-flex"
          >
            Marketplace
          </Link>
          <span
            className="mx-1 hidden h-5 w-px bg-[var(--fm-border)] sm:block"
            aria-hidden="true"
          />
          <Link
            href="/admin/issues/operational-exceptions"
            prefetch={false}
            aria-label="Open operational exceptions"
            className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-[var(--fm-admin-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)]"
          >
            <Bell className="size-4" aria-hidden="true" />
          </Link>
          <AdminThemeToggle />
          <AdminIdentity />
        </div>
      </div>
    </header>
  );
}

function AdminThemeToggle() {
  const { theme, toggleTheme } = useAdminTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
      className="relative inline-flex size-9 items-center justify-center rounded-lg hover:bg-[var(--fm-admin-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)]"
      onClick={toggleTheme}
    >
      <Sun
        className={cn(
          "absolute size-4 transition-[transform,opacity] duration-200",
          dark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100",
        )}
        aria-hidden="true"
      />
      <Moon
        className={cn(
          "absolute size-4 transition-[transform,opacity] duration-200",
          dark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0",
        )}
        aria-hidden="true"
      />
    </button>
  );
}

function AdminIdentity() {
  const { state } = useAdminContext();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  if (state.phase !== "ready") return null;
  const label = state.context.displayName || state.context.email;
  const initial = label.trim().charAt(0).toUpperCase() || "F";

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        setSignOutError("Unable to sign out. Try again.");
        setSigningOut(false);
        return;
      }
      window.location.assign("/auth/login");
    } catch {
      setSignOutError("Unable to sign out. Check your connection and try again.");
      setSigningOut(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Open account menu for ${label}`}
          className="ml-0.5 flex items-center gap-1 rounded-lg p-1 hover:bg-[var(--fm-admin-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)]"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-[var(--fm-admin-accent-soft)] text-xs font-semibold text-[var(--fm-admin-accent-strong)] ring-1 ring-inset ring-[var(--fm-admin-accent)]/20">
            {initial}
          </span>
          <ChevronDown
            className="hidden size-3.5 text-[var(--fm-text-muted)] sm:block"
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        role="menu"
        aria-label="Account menu"
        className="w-64 border-[var(--fm-border)] bg-white p-2 text-[var(--fm-text)] shadow-[var(--fm-shadow-overlay)]"
      >
        <div className="px-2 py-2">
          <p className="truncate text-sm font-semibold">{label}</p>
          <p className="truncate text-xs text-[var(--fm-text-muted)]">{state.context.email}</p>
        </div>
        <div className="my-1 h-px bg-[var(--fm-border)]" aria-hidden="true" />
        <Button
          type="button"
          variant="ghost"
          role="menuitem"
          disabled={signingOut}
          className="w-full justify-start text-[var(--fm-destructive)] hover:bg-[var(--fm-danger-soft)] hover:text-[var(--fm-destructive)]"
          onClick={signOut}
        >
          {signingOut ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <LogOut className="size-4" aria-hidden="true" />
          )}
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
        {signOutError ? (
          <p role="alert" className="px-2 pb-1 pt-2 text-xs text-[var(--fm-destructive)]">
            {signOutError}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function AdminScopeSelector({ fallbackLabel }: { fallbackLabel: string }) {
  const { state, selectScope } = useAdminContext();
  if (state.phase !== "ready") {
    return (
      <span className="inline-flex h-7 items-center gap-2 rounded-lg px-2.5 text-[0.8rem] font-medium">
        <span
          className="size-4 shrink-0 rounded-full bg-[var(--fm-admin-accent)]"
          aria-hidden="true"
        />
        {fallbackLabel.replace(/^Scope:\s*/, "")}
      </span>
    );
  }
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
  const selectedValue = state.selectedScope ? JSON.stringify(state.selectedScope) : undefined;
  const selectedLabel = selections.find(
    (selection) => JSON.stringify(selection.value) === selectedValue,
  )?.label;
  return (
    <Select
      value={selectedValue}
      onValueChange={(value) => selectScope(JSON.parse(value) as AdminSelectedScope)}
    >
      <SelectTrigger
        aria-label="Active admin scope"
        className="h-7 max-w-52 gap-2 rounded-lg border-transparent px-2.5 text-[0.8rem] font-medium shadow-none hover:bg-[var(--fm-hover)] focus-visible:border-[var(--fm-border)] focus-visible:ring-[var(--fm-focus)]/20 [&>svg:last-child]:hidden"
      >
        <span
          className="size-4 shrink-0 rounded-full bg-[var(--fm-admin-accent)]"
          aria-hidden="true"
        />
        <span className="truncate">{selectedLabel ?? "Select scope…"}</span>
        <ChevronsUpDown
          className="size-3.5 shrink-0 text-[var(--fm-text-muted)]"
          aria-hidden="true"
        />
      </SelectTrigger>
      <SelectContent
        position="popper"
        side="bottom"
        sideOffset={4}
        align="start"
        className="border-[var(--fm-border)] bg-white text-[var(--fm-text)] shadow-[var(--fm-shadow-overlay)]"
      >
        {selections.map((selection) => {
          const value = JSON.stringify(selection.value);
          return (
            <SelectItem key={value} value={value}>
              {selection.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
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
        className="rounded-[var(--fm-radius-control)] p-2 hover:bg-[var(--fm-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)] md:hidden"
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
                <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
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
  const parentActive =
    activeCode === item.code || item.children.some((child) => child.code === activeCode);
  return (
    <div>
      {item.children.length > 0 ? (
        <div
          className={cn(
            "flex min-h-11 items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-2.5 text-sm font-normal hover:bg-[var(--fm-hover)]",
            parentActive && "bg-[var(--fm-active)] text-[var(--fm-active-text)]",
          )}
        >
          <item.icon className="size-4" aria-hidden="true" />
          {item.label}
        </div>
      ) : (
        <SheetClose asChild>
          <Link
            href={item.href}
            prefetch={false}
            aria-current={parentActive ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-[var(--fm-radius-control)] px-3 py-2.5 text-sm font-normal hover:bg-[var(--fm-hover)]",
              parentActive && "bg-[var(--fm-active)] text-[var(--fm-active-text)]",
            )}
          >
            <item.icon className="size-4" aria-hidden="true" />
            {item.label}
          </Link>
        </SheetClose>
      )}
      {item.children.length > 0 ? (
        <div className="ml-8 border-l border-[var(--fm-border)] pl-2">
          {item.children.map((child) => {
            const childActive = activeCode === child.code;
            return (
              <SheetClose key={child.code} asChild>
                <Link
                  href={child.href}
                  prefetch={false}
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
  const [query, setQuery] = useState("");

  const visibleGroups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.flatMap((item) => {
          if (item.label.toLocaleLowerCase().includes(normalized)) return [item];
          const children = item.children.filter((child) =>
            child.label.toLocaleLowerCase().includes(normalized),
          );
          return children.length > 0 ? [{ ...item, children }] : [];
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, query]);

  useEffect(() => {
    if (!active) return;
    setOpenParents((current) => new Set([...current, active.parentCode ?? active.code]));
  }, [active?.code, active?.parentCode]);

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "relative hidden shrink-0 bg-transparent transition-[width] duration-200 ease-linear md:block",
          collapsed
            ? "w-[var(--fm-admin-sidebar-collapsed)]"
            : "w-[var(--fm-admin-sidebar-expanded)]",
        )}
      >
        <div
          className={cn(
            "fixed inset-y-0 z-20 hidden h-svh transition-[width,padding] duration-200 ease-linear md:flex",
            collapsed ? "w-[66px] py-2 pl-3 pr-1" : "w-[var(--fm-admin-sidebar-expanded)] p-2",
          )}
        >
          <div className="flex size-full flex-col bg-[var(--fm-admin-canvas)] text-[var(--fm-admin-sidebar-text)]">
            <div className="flex shrink-0 flex-col gap-2 p-2">
              <Link
                href="/admin"
                prefetch={false}
                aria-label="freshmarkets admin home"
                className={cn(
                  "flex shrink-0 items-center overflow-hidden rounded-lg font-semibold tracking-[-0.02em] text-[var(--fm-text)] transition-[width,height,padding] duration-150 ease-in-out hover:bg-[var(--fm-admin-sidebar-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)]",
                  collapsed ? "size-8 p-0" : "h-10 w-full px-2",
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--fm-admin-accent)] text-white shadow-sm">
                  <Sprout className="size-4.5" aria-hidden="true" />
                </span>
                <span
                  className={cn(
                    "overflow-hidden whitespace-nowrap text-sm transition-[max-width,margin,opacity] duration-200 ease-linear",
                    collapsed ? "ml-0 max-w-0 opacity-0" : "ml-2 max-w-40 opacity-100",
                  )}
                >
                  freshmarkets
                </span>
              </Link>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Search admin navigation"
                      className="flex size-8 items-center justify-center rounded-lg text-[var(--fm-admin-sidebar-text)] hover:bg-[var(--fm-admin-sidebar-active)] hover:text-[var(--fm-admin-sidebar-active-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)]"
                      onClick={() => onCollapsedChange(false)}
                    >
                      <Search className="size-4" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="fm-admin-sidebar-tooltip rounded-lg">
                    Search
                  </TooltipContent>
                </Tooltip>
              ) : (
                <div className="relative px-2">
                  <Search
                    className="pointer-events-none absolute left-[18px] top-1/2 size-4 -translate-y-1/2 text-[var(--fm-text-muted)]"
                    aria-hidden="true"
                  />
                  <Input
                    aria-label="Search admin navigation"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search..."
                    className="h-8 bg-[var(--fm-admin-content)] pl-8 text-sm shadow-none"
                  />
                </div>
              )}
            </div>
            <nav
              aria-label="Admin navigation"
              className={cn(
                "fm-admin-sidebar-scroll min-h-0 flex-1 space-y-0 overflow-x-visible",
                collapsed ? "overflow-y-hidden" : "overflow-y-auto",
              )}
            >
              {visibleGroups.map((group) => (
                <div key={group.code} className="relative flex w-full min-w-0 flex-col p-2">
                  {group.code !== "overview" ? (
                    <p
                      className={cn(
                        "flex h-8 shrink-0 items-center overflow-hidden rounded-lg px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--fm-admin-sidebar-text)]/70 transition-[margin,opacity] duration-200 ease-linear",
                        collapsed ? "-mt-8 opacity-0" : "mt-0 opacity-100",
                      )}
                    >
                      {group.label}
                    </p>
                  ) : null}
                  <div className="space-y-0">
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
              ) : visibleGroups.length === 0 ? (
                <p className="px-3 py-2 text-xs text-[var(--fm-text-muted)]">
                  No matching workspaces.
                </p>
              ) : null}
            </nav>
          </div>
        </div>
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
  const [collapsedMenuOpen, setCollapsedMenuOpen] = useState(false);
  const parentActive =
    activeCode === item.code || item.children.some((child) => child.code === activeCode);
  const controlClassName = cn(
    "flex h-8 items-center gap-2 overflow-hidden rounded-lg text-left text-sm font-normal text-[var(--fm-admin-sidebar-text)] transition-[width,height,padding] duration-150 ease-in-out hover:bg-[var(--fm-admin-sidebar-active)] hover:text-[var(--fm-admin-sidebar-active-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)]",
    collapsed ? "w-8 px-2" : "w-full px-2",
    parentActive &&
      "bg-[var(--fm-admin-sidebar-active)] text-[var(--fm-admin-sidebar-active-text)]",
  );
  const label = (
    <span
      className={cn(
        "min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,margin,opacity] duration-200 ease-linear",
        collapsed ? "max-w-0 opacity-0" : "max-w-40 opacity-100",
      )}
    >
      {item.label}
    </span>
  );
  const controlContent = (
    <>
      <item.icon className="size-4 shrink-0" aria-hidden="true" />
      {label}
      {item.children.length > 0 ? (
        <ChevronDown
          className={cn(
            "ml-auto size-4 shrink-0 transition-[max-width,opacity,transform] duration-200 ease-linear",
            collapsed ? "max-w-0 opacity-0" : "max-w-4 opacity-100",
            !open && "-rotate-90",
          )}
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  return (
    <div className="relative">
      {item.children.length > 0 ? (
        <Popover
          open={collapsed && collapsedMenuOpen}
          onOpenChange={(next) => {
            if (collapsed) setCollapsedMenuOpen(next);
          }}
        >
          <Tooltip>
            <PopoverTrigger asChild>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={collapsed ? item.label : undefined}
                  aria-expanded={collapsed ? collapsedMenuOpen : open}
                  aria-controls={collapsed ? undefined : `admin-nav-children-${item.code}`}
                  className={controlClassName}
                  onClick={collapsed ? undefined : onToggle}
                >
                  {controlContent}
                </button>
              </TooltipTrigger>
            </PopoverTrigger>
            {collapsed ? (
              <TooltipContent side="right" className="fm-admin-sidebar-tooltip rounded-lg">
                {item.label}
              </TooltipContent>
            ) : null}
          </Tooltip>
          {collapsed ? (
            <PopoverContent
              side="right"
              align="start"
              sideOffset={4}
              role="menu"
              aria-label={item.label}
              className="w-max min-w-32 max-w-64 rounded-[10px] border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-1 text-[var(--fm-text)] shadow-[var(--fm-shadow-overlay)]"
            >
              <p className="px-2 py-1 text-xs text-[var(--fm-text-muted)]">{item.label}</p>
              {item.children.map((child) => (
                <Link
                  key={child.code}
                  href={child.href}
                  prefetch={false}
                  role="menuitem"
                  className="block rounded-md px-2 py-1.5 text-sm outline-none hover:bg-[var(--fm-admin-sidebar-active)] hover:text-[var(--fm-admin-sidebar-active-text)] focus:bg-[var(--fm-admin-sidebar-active)] focus:text-[var(--fm-admin-sidebar-active-text)]"
                >
                  {child.label}
                </Link>
              ))}
            </PopoverContent>
          ) : null}
        </Popover>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={item.href}
              prefetch={false}
              aria-label={collapsed ? item.label : undefined}
              aria-current={activeCode === item.code ? "page" : undefined}
              className={controlClassName}
            >
              {controlContent}
            </Link>
          </TooltipTrigger>
          {collapsed ? (
            <TooltipContent side="right" className="fm-admin-sidebar-tooltip rounded-lg">
              {item.label}
            </TooltipContent>
          ) : null}
        </Tooltip>
      )}
      {!collapsed && open && item.children.length > 0 ? (
        <div id={`admin-nav-children-${item.code}`} className="ml-4 pl-2">
          {item.children.map((child) => (
            <Link
              key={child.code}
              href={child.href}
              prefetch={false}
              aria-current={activeCode === child.code ? "page" : undefined}
              className={cn(
                "block rounded-lg px-2 py-1.5 text-sm text-[var(--fm-admin-sidebar-text)] hover:bg-[var(--fm-admin-sidebar-active)] hover:text-[var(--fm-admin-sidebar-active-text)]",
                activeCode === child.code &&
                  "bg-[var(--fm-admin-sidebar-active)] font-medium text-[var(--fm-admin-sidebar-active-text)]",
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
            <Link
              href="/auth/login?redirectTo=/admin"
              prefetch={false}
              className="font-medium underline"
            >
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
      items={adminNavigationFromContext(
        adminNavigationItemsForScope(state.context.navigation, state.selectedScope),
      )}
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
    <div className="flex flex-col gap-3 border-b border-[var(--fm-border)] pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 id="admin-page-title" className="text-2xl font-bold tracking-[-0.025em]">
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
