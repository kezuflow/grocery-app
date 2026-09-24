"use client";

import type {
  AdminMembershipPage,
  AdminMembershipSummary,
  RpcResult,
} from "@freshmarkets/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AdminCursorPagination,
  useAdminUrlPagination,
} from "../../../components/admin/admin-controls";
import { AdminPageState } from "../../../components/admin/admin-page-state";
import { PageHeader } from "../../../components/admin/admin-shell";
import { MembershipStatusBadge } from "../../../components/admin/customer-status-badges";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { useAdminContext } from "../admin-context-provider";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId?: string }
  | { phase: "ready" };

function date(value: string | null): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function cancellationLabel(membership: AdminMembershipSummary): string {
  if (membership.state === "CANCELED") return "Canceled";
  if (membership.cancelAtPeriodEnd) return "Scheduled for period end";
  return "None scheduled";
}

export default function MembershipsPage() {
  const admin = useAdminContext();
  if (admin.state.phase !== "ready") {
    return (
      <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
        <PageHeader title="Membership history" />
        <AdminPageState state="loading" title="Loading membership access" />
      </section>
    );
  }

  const canRead =
    admin.state.selectedScope?.kind === "GLOBAL" &&
    admin.state.context.capabilities.includes("memberships.read");
  if (!canRead) {
    return (
      <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
        <PageHeader title="Membership history" />
        <AdminPageState
          state="error"
          title="Membership access denied"
          message="Retained membership records require the memberships.read capability with a Global scope."
        />
      </section>
    );
  }

  const scopeKey = JSON.stringify(admin.state.selectedScope);
  return <MembershipsWorkspace key={scopeKey} scopeKey={scopeKey} />;
}

function MembershipsWorkspace({ scopeKey }: { scopeKey: string }) {
  const requestVersion = useRef(0);
  const searchParams = useSearchParams();
  const appliedQuery = searchParams.get("query") ?? "";
  const [query, setQuery] = useState(appliedQuery);
  const [page, setPage] = useState<AdminMembershipPage | null>(null);
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const pagination = useAdminUrlPagination("/admin/memberships");
  const listUrl = `/admin/memberships${searchParams.size ? `?${searchParams}` : ""}`;

  useEffect(() => setQuery(appliedQuery), [appliedQuery]);

  function recordHref(membership: AdminMembershipSummary): string {
    return `/admin/memberships/${encodeURIComponent(membership.subscriptionId)}?returnTo=${encodeURIComponent(listUrl)}&returnScope=${encodeURIComponent(scopeKey)}`;
  }

  function rememberReturn() {
    sessionStorage.setItem(
      `freshmarkets.admin.memberships.return:${scopeKey}`,
      JSON.stringify({ url: listUrl, y: window.scrollY }),
    );
  }

  useEffect(() => {
    if (state.phase !== "ready") return;
    const key = `freshmarkets.admin.memberships.return:${scopeKey}`;
    const stored = sessionStorage.getItem(key);
    if (!stored) return;
    sessionStorage.removeItem(key);
    try {
      const target = JSON.parse(stored) as { url: string; y: number };
      if (target.url === `${window.location.pathname}${window.location.search}` && target.y >= 0) {
        window.requestAnimationFrame(() => window.scrollTo(0, target.y));
      }
    } catch {
      // Invalid return state cannot change the membership list.
    }
  }, [scopeKey, state.phase]);

  const load = useCallback(async (search: string, cursor: string | null) => {
    const version = ++requestVersion.current;
    setState({ phase: "loading" });
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (search.trim()) params.set("query", search.trim());
      if (cursor) params.set("cursor", cursor);
      const payload = (await (
        await fetch(`/api/admin/memberships?${params}`)
      ).json()) as RpcResult<AdminMembershipPage>;
      if (version !== requestVersion.current) return;
      if (!payload.ok) {
        setState({
          phase: "error",
          message:
            payload.error.code === "FORBIDDEN"
              ? "Retained membership records require the memberships.read capability with a Global scope."
              : payload.error.message,
          requestId: payload.error.requestId,
        });
        return;
      }
      setPage(payload.value);
      setState({ phase: "ready" });
    } catch {
      if (version !== requestVersion.current) return;
      setState({
        phase: "error",
        message: "The membership history could not be loaded. Check the connection and retry.",
      });
    }
  }, []);

  useEffect(() => {
    void load(appliedQuery, pagination.cursor);
    return () => {
      requestVersion.current += 1;
    };
  }, [appliedQuery, load, pagination.cursor]);

  function applySearch(nextQuery: string) {
    const next = new URLSearchParams(searchParams.toString());
    const normalized = nextQuery.trim();
    if (normalized) next.set("query", normalized);
    else next.delete("query");
    pagination.reset(next);
    window.history.pushState(null, "", `/admin/memberships${next.size ? `?${next}` : ""}`);
  }

  const memberships = page?.items ?? [];
  return (
    <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
      <PageHeader
        title="Membership history"
        description="Retained membership records are available for review and supported cancellation only."
      />

      <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] shadow-[var(--fm-shadow-card)]">
        <h2 className="sr-only">Membership list</h2>
        <form
          className="flex min-h-14 flex-wrap items-center gap-2 border-b border-[var(--fm-border)] px-4 py-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            applySearch(query);
          }}
        >
          <Input
            aria-label="Search membership history"
            placeholder="Search by customer email or membership ID"
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 sm:w-80"
          />
          <Button type="submit" size="sm" variant="outline">
            Search
          </Button>
          {query || appliedQuery ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setQuery("");
                applySearch("");
              }}
            >
              Clear
            </Button>
          ) : null}
        </form>

        {state.phase === "loading" ? (
          <div className="p-4">
            <AdminPageState state="loading" title="Loading membership history" />
          </div>
        ) : null}
        {state.phase === "error" ? (
          <div className="p-4">
            <AdminPageState
              state="error"
              title="Membership history could not be loaded"
              message={state.message}
              requestId={state.requestId}
              onRetry={() => void load(appliedQuery, pagination.cursor)}
            />
          </div>
        ) : null}
        {state.phase === "ready" && memberships.length === 0 ? (
          <div className="p-4">
            <AdminPageState
              state={appliedQuery ? "filtered-empty" : "empty"}
              message="No retained memberships are visible in this view."
            />
          </div>
        ) : null}
        {state.phase === "ready" && memberships.length > 0 ? (
          <>
            <ul
              aria-label="Membership list"
              className="divide-y divide-[var(--fm-border)] sm:hidden"
            >
              {memberships.map((membership) => (
                <li key={membership.subscriptionId} className="space-y-3 p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={recordHref(membership)}
                        prefetch={false}
                        onClick={rememberReturn}
                        className="break-all font-semibold hover:underline"
                      >
                        {membership.customerEmail}
                      </Link>
                      <p className="mt-1 truncate font-mono text-[11px] text-[var(--fm-text-muted)]">
                        {membership.subscriptionId}
                      </p>
                    </div>
                    <MembershipStatusBadge status={membership.state} />
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-[var(--fm-text-muted)]">Period end</dt>
                      <dd>{date(membership.currentPeriodEndsAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--fm-text-muted)]">Cancellation</dt>
                      <dd>{cancellationLabel(membership)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
              <Table aria-label="Membership list">
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Period end</TableHead>
                    <TableHead>Cancellation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memberships.map((membership) => (
                    <TableRow key={membership.subscriptionId}>
                      <TableCell>
                        <Link
                          href={recordHref(membership)}
                          prefetch={false}
                          onClick={rememberReturn}
                          className="break-all font-medium hover:underline"
                        >
                          {membership.customerEmail}
                        </Link>
                        <p className="mt-0.5 max-w-64 truncate font-mono text-[11px] text-[var(--fm-text-muted)]">
                          {membership.subscriptionId}
                        </p>
                      </TableCell>
                      <TableCell>
                        <MembershipStatusBadge status={membership.state} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                        {date(membership.currentPeriodEndsAt)}
                      </TableCell>
                      <TableCell className="text-sm text-[var(--fm-text-muted)]">
                        {cancellationLabel(membership)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}

        {state.phase === "ready" ? (
          <AdminCursorPagination
            pageNumber={pagination.pageNumber}
            nextCursor={page?.nextCursor ?? null}
            onPrevious={pagination.previous}
            onNext={pagination.next}
          />
        ) : null}
      </section>
    </section>
  );
}
