"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AdminNavigationItem,
  OperationalExceptionItem,
  OperationalExceptionPage,
  RpcResult,
} from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { Button } from "../../../../components/ui/button";
import { Skeleton } from "../../../../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../components/ui/table";
import { ListPageSection, PageHeader, StatusBadge } from "../../../../components/admin/admin-shell";
import { useAdminLocation } from "../../../../components/admin/use-admin-location";
import {
  AdminCursorPagination,
  useAdminPagination,
} from "../../../../components/admin/admin-controls";
import { AdminPageState } from "../../../../components/admin/admin-page-state";
import { adminNavigationItemsForScope } from "../../../../components/admin/admin-navigation";
import { useAdminContext } from "../../admin-context-provider";
import { useAdminOperationalRefresh } from "../../admin-operational-refresh-provider";

function sourceHref(
  item: OperationalExceptionItem,
  locationId: string,
  navigation: ReadonlyArray<AdminNavigationItem>,
): string | null {
  if (item.locationId !== locationId) return null;
  const code = item.source.toLowerCase();
  const destination = navigation.find((entry) => entry.code === code && entry.kind === "workspace");
  if (!destination) return null;
  if (item.source === "FULFILLMENT" || item.source === "DELIVERY") {
    return item.orderId ? `${destination.href}?orderId=${encodeURIComponent(item.orderId)}` : null;
  }
  return destination.href;
}

function displayCode(value: string): string {
  if (!/^[A-Z_]+$/.test(value)) return value;
  const words = value.replaceAll("_", " ").toLowerCase();
  return words[0].toUpperCase() + words.slice(1);
}

export default function OperationalExceptionsPage() {
  const admin = useAdminContext();
  const { locationId, label } = useAdminLocation();
  const operationalRefresh = useAdminOperationalRefresh();
  const [page, setPage] = useState<OperationalExceptionPage | null>(null);
  const [pageKey, setPageKey] = useState<string | null>(null);
  const [state, setState] = useState("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const pagination = useAdminPagination(locationId);
  const requestSequence = useRef(0);
  const pageKeyRef = useRef<string | null>(null);
  const observedRefreshAttempt = useRef(operationalRefresh.refreshAttempt);
  const queryKey = `${locationId}:${pagination.cursor}`;
  const navigation =
    admin.state.phase === "ready"
      ? adminNavigationItemsForScope(admin.state.context.navigation, admin.state.selectedScope)
      : [];
  const load = useCallback(
    async (cursor: string | null, background = false) => {
      if (!locationId) return;
      const sequence = ++requestSequence.current;
      const key = `${locationId}:${cursor}`;
      if (!background) {
        setState("loading");
        setNotice(null);
      }
      try {
        const payload = (await (
          await fetch(
            `/api/admin/exceptions?locationId=${encodeURIComponent(locationId)}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          )
        ).json()) as RpcResult<OperationalExceptionPage>;
        if (sequence !== requestSequence.current) return;
        if (!payload.ok) {
          setNotice(
            payload.error.code === "FORBIDDEN"
              ? "Operational exception access is not permitted for this scope."
              : payload.error.message,
          );
          if (!background || pageKeyRef.current !== key) setState("error");
          return;
        }
        setPage(payload.value);
        pageKeyRef.current = key;
        setPageKey(key);
        setNotice(null);
        setState("ready");
      } catch {
        if (sequence !== requestSequence.current) return;
        setNotice("Network error loading operational exceptions.");
        if (!background || pageKeyRef.current !== key) setState("error");
      }
    },
    [locationId],
  );
  useEffect(() => {
    if (locationId) void load(pagination.cursor);
    return () => {
      requestSequence.current += 1;
    };
  }, [load, locationId, pagination.cursor]);
  useEffect(() => {
    if (observedRefreshAttempt.current === operationalRefresh.refreshAttempt) return;
    observedRefreshAttempt.current = operationalRefresh.refreshAttempt;
    if (locationId && pageKeyRef.current === queryKey) void load(pagination.cursor, true);
  }, [operationalRefresh.refreshAttempt, load, locationId, pagination.cursor, queryKey]);
  const currentPage = pageKey === queryKey ? page : null;
  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Operational exceptions"
        description={`Review exceptions for ${label} and open the relevant workspace to resolve them.`}
      />
      {!locationId ? (
        <AdminPageState
          state="permission-empty"
          title="Select a permitted location"
          message="Choose a location scope in the Admin header to inspect operational exceptions."
        />
      ) : null}
      {locationId && state === "loading" ? (
        <div role="status" aria-label="Loading operational exceptions">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-3 h-12 w-full" />
        </div>
      ) : null}
      {locationId && state === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Operational exceptions could not be loaded</AlertTitle>
          <AlertDescription>
            {notice}
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => void load(pagination.cursor)}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {locationId && state === "ready" && currentPage ? (
        <ListPageSection
          title="Exception queue"
          description="Open the source workspace to resolve an exception with its current aggregate version."
        >
          {notice ? (
            <p role="status" className="border-b p-3 text-sm">
              {notice}
            </p>
          ) : null}
          {currentPage.items.length === 0 ? (
            <p className="p-5 text-sm text-[var(--fm-text-muted)]">
              No operational exceptions for this location.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source / severity</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Age / owner</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Resolution</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentPage.items.map((item) => (
                    <TableRow key={`${item.kind}-${item.referenceId}`}>
                      <TableCell>
                        <div className="space-y-1">
                          <StatusBadge>{displayCode(item.source)}</StatusBadge>
                          <div className="text-xs text-[var(--fm-text-muted)]">
                            {displayCode(item.severity)}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="break-all font-mono text-xs">
                        <div>{item.referenceId}</div>
                        {sourceHref(item, locationId, navigation) ? (
                          <Link
                            className="font-sans font-medium underline underline-offset-2"
                            href={sourceHref(item, locationId, navigation)!}
                            prefetch={false}
                          >
                            Open {item.source.toLowerCase()}
                          </Link>
                        ) : (
                          <span className="font-sans text-[var(--fm-text-muted)]">
                            Source link unavailable
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {item.locationId === locationId ? label : (item.locationId ?? "—")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {item.ageMinutes === null ? "Age unavailable" : `${item.ageMinutes}m old`} ·{" "}
                        {item.ownerId ?? "Unassigned"}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{displayCode(item.reason)}</div>
                        <div>{item.detail}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {item.permittedActions.length > 0 ? (
                            item.permittedActions.map((action) => (
                              <StatusBadge key={action}>{displayCode(action)}</StatusBadge>
                            ))
                          ) : (
                            <span className="text-xs text-[var(--fm-text-muted)]">
                              Source-owned; unavailable here
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <AdminCursorPagination
            pageNumber={pagination.pageNumber}
            nextCursor={currentPage.nextCursor}
            onPrevious={pagination.previous}
            onNext={pagination.next}
          />
        </ListPageSection>
      ) : null}
    </div>
  );
}
