"use client";
import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AdminAuditEventPage } from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import { Button } from "../../../components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { PageHeader, FilterBar, ListPageSection } from "../../../components/admin/admin-shell";

type PageState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready"; page: AdminAuditEventPage };

type AuditFilters = {
  action: string;
  actorId: string;
  locationId: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: AuditFilters = {
  action: "",
  actorId: "",
  locationId: "",
  from: "",
  to: "",
};

function formatInstant(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "Z");
}

export default function AuditPage() {
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Audit log"
        description="Immutable material operations, scoped to your assigned market and locations."
      />
      <Suspense fallback={<AuditLoading />}>
        <AuditWorkspace />
      </Suspense>
    </div>
  );
}

function AuditWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo<AuditFilters>(
    () => ({
      action: searchParams.get("action") ?? "",
      actorId: searchParams.get("actorId") ?? "",
      locationId: searchParams.get("locationId") ?? "",
      from: searchParams.get("from") ?? "",
      to: searchParams.get("to") ?? "",
    }),
    [searchParams],
  );
  const cursor = searchParams.get("cursor") ?? "";
  const limit = searchParams.get("limit") ?? "50";

  const [draft, setDraft] = useState<AuditFilters>(filters);
  useEffect(() => setDraft(filters), [filters]);

  const [state, setState] = useState<PageState>({ phase: "loading" });

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.action) params.set("action", filters.action);
    if (filters.actorId) params.set("actorId", filters.actorId);
    if (filters.locationId) params.set("locationId", filters.locationId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (limit !== "50") params.set("limit", limit);
    if (cursor) params.set("cursor", cursor);
    return params.toString();
  }, [filters, limit, cursor]);

  useEffect(() => {
    let active = true;
    setState({ phase: "loading" });
    fetch(`/api/admin/audit${query ? `?${query}` : ""}`)
      .then(
        (response) =>
          response.json() as Promise<{
            ok: boolean;
            error?: { code: string; message: string; requestId?: string };
            value?: AdminAuditEventPage;
          }>,
      )
      .then((payload) => {
        if (!active) return;
        if (payload.ok && payload.value) {
          setState({ phase: "ready", page: payload.value });
        } else {
          setState({
            phase: "error",
            message:
              payload.error?.code === "FORBIDDEN"
                ? "Your role does not include the audit.read capability."
                : payload.error?.code === "VALIDATION_FAILED"
                  ? "One of the applied filters is invalid; clear filters and try again."
                  : (payload.error?.message ?? "The audit log could not be loaded."),
            requestId: payload.error?.requestId ?? null,
          });
        }
      })
      .catch(() => {
        if (active) {
          setState({
            phase: "error",
            message: "Network error loading the audit log.",
            requestId: null,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [query]);

  const applyFilters = useCallback(
    (next: AuditFilters) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(next)) {
        if (value.trim() !== "") params.set(key, value.trim());
      }
      router.replace(`${pathname}${params.size > 0 ? `?${params}` : ""}`, { scroll: false });
    },
    [router, pathname],
  );

  const gotoCursor = useCallback(
    (nextCursor: string | null) => {
      const params = new URLSearchParams(query);
      if (nextCursor) params.set("cursor", nextCursor);
      else params.delete("cursor");
      router.replace(`${pathname}${params.size > 0 ? `?${params}` : ""}`, { scroll: false });
    },
    [router, pathname, query],
  );

  const hasFilters = Object.values(filters).some((value) => value !== "");

  return (
    <>
      <FilterBar>
        <form
          className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters(draft);
          }}
        >
          <Input
            aria-label="Filter by action"
            placeholder="Action, e.g. ORDER.ADJUSTED"
            value={draft.action}
            onChange={(event) => setDraft({ ...draft, action: event.target.value })}
            className="sm:w-56"
          />
          <Input
            aria-label="Filter by actor ID"
            placeholder="Actor ID"
            value={draft.actorId}
            onChange={(event) => setDraft({ ...draft, actorId: event.target.value })}
            className="sm:w-48"
          />
          <Input
            aria-label="Filter by location ID"
            placeholder="Location ID"
            value={draft.locationId}
            onChange={(event) => setDraft({ ...draft, locationId: event.target.value })}
            className="sm:w-48"
          />
          <Input
            aria-label="From instant"
            placeholder="From (ISO instant)"
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            className="sm:w-48"
          />
          <Input
            aria-label="To instant"
            placeholder="To (ISO instant)"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            className="sm:w-48"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Apply filters
            </Button>
            {hasFilters || cursor ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setDraft(EMPTY_FILTERS);
                  applyFilters(EMPTY_FILTERS);
                }}
              >
                Clear all
              </Button>
            ) : null}
          </div>
        </form>
        <span className="text-xs text-[var(--fm-text-muted)]">
          {filters.locationId
            ? `Location scope filter: ${filters.locationId}`
            : "All permitted locations"}
        </span>
      </FilterBar>

      {state.phase === "loading" ? <AuditLoading /> : null}

      {state.phase === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>The audit log could not be loaded</AlertTitle>
          <AlertDescription>
            {state.message}
            {state.requestId ? (
              <>
                <br />
                <span className="font-mono text-xs">Request reference: {state.requestId}</span>
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {state.phase === "ready" ? (
        state.page.items.length === 0 ? (
          <ListPageSection title="Audit events">
            <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
              {hasFilters
                ? "No audit events match the applied filters. Clear filters to see the permitted history."
                : "No audit events exist for your permitted scope yet."}
            </p>
          </ListPageSection>
        ) : (
          <ListPageSection
            title="Audit events"
            description="Newest first. Select an event for its sanitized detail."
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>
                    <span className="sr-only">Detail link</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.page.items.map((item) => (
                  <TableRow key={item.auditEventId}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {formatInstant(item.occurredAt)}
                    </TableCell>
                    <TableCell className="font-medium">{item.action}</TableCell>
                    <TableCell className="text-xs">
                      {item.resourceType}:{item.resourceId}
                    </TableCell>
                    <TableCell className="text-xs text-[var(--fm-text-muted)]">
                      {item.locationId ?? item.marketId ?? "Global"}
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-xs">
                      {item.reason ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/audit/${item.auditEventId}`}
                        prefetch={false}
                        className="text-xs font-medium text-[var(--fm-info)] underline"
                      >
                        Detail
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between gap-3 border-t border-[var(--fm-border)] px-4 py-3">
              <span className="text-xs text-[var(--fm-text-muted)]">
                {state.page.items.length} event{state.page.items.length === 1 ? "" : "s"} on this
                page
              </span>
              <div className="flex gap-2">
                {cursor ? (
                  <Button size="sm" variant="outline" onClick={() => gotoCursor(null)}>
                    First page
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={state.page.nextCursor === null}
                  onClick={() => gotoCursor(state.page.nextCursor)}
                >
                  Older events
                </Button>
              </div>
            </div>
          </ListPageSection>
        )
      ) : null}
    </>
  );
}

function AuditLoading() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading audit events">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
