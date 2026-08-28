"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PrivacyRequestPage, RpcResult } from "@freshmarkets/contracts";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Skeleton } from "../../../../components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../components/ui/table";
import { PageHeader, ListPageSection, StatusBadge } from "../../../../components/admin/admin-shell";
import { CUSTOMER_SUB_NAVIGATION } from "../../../../components/admin/admin-navigation";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready"; page: PrivacyRequestPage };

const STATUS_FILTERS = [
  "SUBMITTED",
  "VERIFYING",
  "APPROVED",
  "REJECTED",
  "PROCESSING",
  "COMPLETED",
  "ESCALATED",
] as const;

/** Legal next action per queue status; Core revalidates authoritatively. */
function nextActions(status: string): ReadonlyArray<string> {
  switch (status) {
    case "SUBMITTED":
      return ["VERIFY", "APPROVE", "REJECT"];
    case "VERIFYING":
      return ["APPROVE", "REJECT", "ESCALATE"];
    case "APPROVED":
      return ["BEGIN_PROCESSING"];
    case "PROCESSING":
      return ["COMPLETE", "ESCALATE"];
    case "ESCALATED":
      return ["BEGIN_PROCESSING"];
    default:
      return [];
  }
}

export default function PrivacyQueuePage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [statusFilter, setStatusFilter] = useState<string>("SUBMITTED");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback((status: string) => {
    setState({ phase: "loading" });
    void (async () => {
      try {
        const response = await fetch(`/api/admin/privacy-requests?status=${status}&limit=50`);
        const payload = (await response.json()) as RpcResult<PrivacyRequestPage>;
        if (!payload.ok) {
          setState({
            phase: "error",
            message:
              payload.error.code === "FORBIDDEN"
                ? "The privacy queue requires the customers.read capability with a global scope."
                : payload.error.message,
            requestId: payload.error.requestId,
          });
          return;
        }
        setState({ phase: "ready", page: payload.value });
      } catch {
        setState({
          phase: "error",
          message: "Network error loading the privacy queue.",
          requestId: null,
        });
      }
    })();
  }, []);

  useEffect(() => load(statusFilter), [load, statusFilter]);

  async function apply(requestId: string, action: string, version: number) {
    if (reason.trim() === "") {
      setNotice("A reason is required for every action.");
      return;
    }
    const response = await fetch(
      `/api/admin/privacy-requests/${encodeURIComponent(requestId)}/actions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ action, reason: reason.trim(), expectedVersion: version }),
      },
    );
    const payload = (await response.json()) as RpcResult<unknown> & {
      error?: { message?: string };
    };
    setNotice(payload.ok ? `Applied ${action}.` : (payload.error?.message ?? "The action failed."));
    if (payload.ok) load(statusFilter);
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Privacy queue"
        description="Data-subject requests worked through a legal transition lifecycle. Nothing is ever hard-deleted."
      />
      <nav aria-label="Customer sub-navigation" className="flex gap-3 text-sm">
        {CUSTOMER_SUB_NAVIGATION.map((item) => (
          <Link
            key={item.code}
            href={item.href}
            className={
              item.code === "customers-privacy"
                ? "font-semibold text-[var(--fm-primary-dark)] underline"
                : "text-[var(--fm-text-muted)] hover:text-[var(--fm-text)]"
            }
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {state.phase === "loading" ? (
        <div className="space-y-3" role="status" aria-label="Loading privacy requests">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}

      {state.phase === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>The privacy queue could not be loaded</AlertTitle>
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
        <>
          {notice ? (
            <p
              role="status"
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-3 text-sm"
            >
              {notice}
            </p>
          ) : null}

          <ListPageSection
            title="Requests"
            description="One reason applies to the selected action."
          >
            <div className="flex flex-wrap gap-2 px-4 pt-4">
              {STATUS_FILTERS.map((status) => (
                <Button
                  key={status}
                  size="sm"
                  variant={statusFilter === status ? "default" : "outline"}
                  onClick={() => setStatusFilter(status)}
                >
                  {status}
                </Button>
              ))}
            </div>
            <div className="p-4 pb-0">
              <Input
                aria-label="Shared action reason"
                placeholder="reason for the next action (required)"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="sm:w-96"
              />
            </div>
            {state.page.items.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
                No {statusFilter} requests.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead>Next actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.page.items.map((request) => (
                    <TableRow key={request.privacyRequestId}>
                      <TableCell>
                        <Link
                          href={`/admin/customers/${request.customerId}`}
                          className="font-mono text-xs text-[var(--fm-info)] underline"
                        >
                          {request.customerId}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs">{request.requestType}</TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={
                            request.status === "COMPLETED"
                              ? "success"
                              : request.status === "REJECTED"
                                ? "neutral"
                                : request.status === "ESCALATED"
                                  ? "danger"
                                  : "info"
                          }
                        >
                          {request.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {request.requestedAt.slice(0, 10)}
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap gap-1">
                          {nextActions(request.status).map((action) => (
                            <Button
                              key={action}
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void apply(request.privacyRequestId, action, request.version)
                              }
                            >
                              {action}
                            </Button>
                          ))}
                          {nextActions(request.status).length === 0 ? (
                            <span className="text-xs text-[var(--fm-text-muted)]">—</span>
                          ) : null}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ListPageSection>
        </>
      ) : null}
    </div>
  );
}
