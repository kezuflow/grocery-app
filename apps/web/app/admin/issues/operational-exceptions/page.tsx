"use client";
import { useCallback, useEffect, useState } from "react";
import type { OperationalExceptionPage, RpcResult } from "@freshmarkets/contracts";
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
const location = "location-cebu-central";
export default function OperationalExceptionsPage() {
  const [page, setPage] = useState<OperationalExceptionPage | null>(null);
  const [state, setState] = useState("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    setState("loading");
    try {
      const payload = (await (
        await fetch(`/api/admin/exceptions?locationId=${location}&limit=50`)
      ).json()) as RpcResult<OperationalExceptionPage>;
      if (!payload.ok) {
        setNotice(
          payload.error.code === "FORBIDDEN"
            ? "Operational exception access is not permitted for this scope."
            : payload.error.message,
        );
        setState("error");
        return;
      }
      setPage(payload.value);
      setState("ready");
    } catch {
      setNotice("Network error loading operational exceptions.");
      setState("error");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Operational exceptions"
        description="Cross-domain exception visibility with source-owned resolution commands."
      />
      {state === "loading" ? (
        <div role="status" aria-label="Loading operational exceptions">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-3 h-12 w-full" />
        </div>
      ) : null}
      {state === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Operational exceptions could not be loaded</AlertTitle>
          <AlertDescription>
            {notice}
            <Button className="mt-3" size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state === "ready" && page ? (
        <ListPageSection
          title="Exception queue"
          description="Open the source workspace to resolve an exception with its current aggregate version."
        >
          {notice ? (
            <p role="status" className="border-b p-3 text-sm">
              {notice}
            </p>
          ) : null}
          {page.items.length === 0 ? (
            <p className="p-5 text-sm text-[var(--fm-text-muted)]">
              No operational exceptions for this location.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Resolution</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.items.map((item) => (
                    <TableRow key={`${item.kind}-${item.referenceId}`}>
                      <TableCell>
                        <StatusBadge>{item.kind}</StatusBadge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.referenceId}</TableCell>
                      <TableCell>{item.locationId ?? "—"}</TableCell>
                      <TableCell>{item.detail}</TableCell>
                      <TableCell>
                        {item.kind === "FULFILLMENT_SHORTAGE"
                          ? "Fulfillment queue"
                          : item.kind === "DELIVERY_FAILED"
                            ? "Delivery queue"
                            : "Receiving session"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </ListPageSection>
      ) : null}
    </div>
  );
}
