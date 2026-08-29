"use client";
import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import type { AdminCustomerDetail, RpcResult } from "@freshmarkets/contracts";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Skeleton } from "../../../../components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../../../../components/ui/breadcrumb";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../components/ui/table";
import { PageHeader, ListPageSection, StatusBadge } from "../../../../components/admin/admin-shell";
import { useAdminCommandIntent } from "../../../../components/admin/admin-command-state";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready"; customer: AdminCustomerDetail };

const CLOSURE_TYPES = ["ACCESS", "CORRECTION", "CLOSURE", "ANONYMIZATION"] as const;

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ "customer-id": string }>;
}) {
  const { "customer-id": customerId } = use(params);
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [reason, setReason] = useState("");
  const [closureType, setClosureType] = useState<(typeof CLOSURE_TYPES)[number]>("CLOSURE");
  const [notice, setNotice] = useState<string | null>(null);
  const commandIntent = useAdminCommandIntent();

  const load = useCallback(() => {
    setState({ phase: "loading" });
    void (async () => {
      try {
        const response = await fetch(`/api/admin/customers/${encodeURIComponent(customerId)}`);
        const payload = (await response.json()) as RpcResult<AdminCustomerDetail>;
        if (!payload.ok) {
          setState({
            phase: "error",
            message: payload.error.message,
            requestId: payload.error.requestId,
          });
          return;
        }
        setState({ phase: "ready", customer: payload.value });
      } catch {
        setState({
          phase: "error",
          message: "Network error loading the customer.",
          requestId: null,
        });
      }
    })();
  }, [customerId]);

  useEffect(() => load(), [load]);

  async function run(url: string, body: unknown) {
    const payload = await commandIntent.submit(async (idempotencyKey) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(body),
      });
      return (await response.json()) as RpcResult<unknown>;
    });
    setNotice(payload.ok ? "Applied." : (payload.error?.message ?? "The command failed."));
    if (payload.ok) load();
    return payload.ok;
  }

  if (state.phase === "loading") {
    return (
      <div className="space-y-3" role="status" aria-label="Loading customer">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>The customer could not be loaded</AlertTitle>
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
    );
  }

  const { customer } = state;

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Admin</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin/customers">Customers</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{customer.email}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <PageHeader
        title={customer.email}
        description={`Joined ${customer.createdAt.slice(0, 10)} · ${customer.orderCount} order${customer.orderCount === 1 ? "" : "s"} · v${customer.version}`}
        action={
          <StatusBadge tone={customer.accessStatus === "active" ? "success" : "danger"}>
            {customer.accessStatus}
          </StatusBadge>
        }
      />

      {notice ? (
        <p
          role="status"
          className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-3 text-sm"
        >
          {notice}
        </p>
      ) : null}

      <ListPageSection
        title="Commerce access and sessions"
        description="Disabling access blocks checkout and account commerce surfaces; sessions revoke immediately."
      >
        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
          <Input
            aria-label="Reason"
            placeholder="reason (required)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="sm:w-72"
          />
          <Button
            size="sm"
            variant={customer.accessStatus === "active" ? "destructive" : "default"}
            onClick={() => {
              if (reason.trim() === "") {
                setNotice("A reason is required.");
                return;
              }
              void run(`/api/admin/customers/${encodeURIComponent(customerId)}/access`, {
                action: customer.accessStatus === "active" ? "DISABLE" : "RESTORE",
                reason: reason.trim(),
                expectedVersion: customer.version,
              });
            }}
          >
            {customer.accessStatus === "active" ? "Disable access" : "Restore access"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (reason.trim() === "") {
                setNotice("A reason is required.");
                return;
              }
              void run(`/api/admin/customers/${encodeURIComponent(customerId)}/sessions/revoke`, {
                reason: reason.trim(),
              });
            }}
          >
            Revoke sessions
          </Button>
        </div>
      </ListPageSection>

      <ListPageSection
        title="Privacy / closure request"
        description="Opens an auditable request in the privacy queue. Completion never deletes order, payment, or audit history."
      >
        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
          <select
            aria-label="Request type"
            value={closureType}
            onChange={(event) =>
              setClosureType(event.target.value as (typeof CLOSURE_TYPES)[number])
            }
            className="h-10 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3 text-sm"
          >
            {CLOSURE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (reason.trim() === "") {
                setNotice("A reason is required.");
                return;
              }
              void run(`/api/admin/customers/${encodeURIComponent(customerId)}/closure-requests`, {
                requestType: closureType,
                reason: reason.trim(),
              });
            }}
          >
            Open request
          </Button>
          <Link
            href="/admin/customers/privacy"
            className="text-xs font-medium text-[var(--fm-info)] underline"
          >
            Open privacy queue
          </Link>
        </div>
      </ListPageSection>

      <ListPageSection
        title="Recent material history"
        description="Sanitized audit summaries for this account."
      >
        {customer.recentAudit.length === 0 ? (
          <p className="p-5 text-sm text-[var(--fm-text-muted)]">No material history recorded.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customer.recentAudit.map((event) => (
                <TableRow key={event.auditEventId}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {event.occurredAt.replace("T", " ").replace(/\.\d+Z$/, "Z")}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{event.action}</TableCell>
                  <TableCell className="text-xs">
                    {event.resourceType}:{event.resourceId}
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-xs">{event.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListPageSection>
    </div>
  );
}
