"use client";

import type {
  PrivacyRequestAction,
  PrivacyRequestPage,
  PrivacyRequestStatus,
  PrivacyRequestView,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  BadgeCheck,
  CheckCheck,
  Clipboard,
  EllipsisVertical,
  Eye,
  Play,
  ShieldCheck,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AdminConfirmationDialog,
  AdminCursorPagination,
  useAdminPagination,
} from "../../../../components/admin/admin-controls";
import { useAdminCommandIntent } from "../../../../components/admin/admin-command-state";
import { PrivacyRequestStatusBadge } from "../../../../components/admin/customer-status-badges";
import { AdminLiveRegion, AdminPageState } from "../../../../components/admin/admin-page-state";
import { PageHeader } from "../../../../components/admin/admin-shell";
import { Button } from "../../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../../components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../components/ui/table";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId?: string }
  | { phase: "ready" };

type PendingAction = {
  request: PrivacyRequestView;
  action: PrivacyRequestAction;
};

const privacyViews: ReadonlyArray<{
  label: string;
  status: PrivacyRequestStatus | "";
}> = [
  { label: "All", status: "" },
  { label: "Submitted", status: "SUBMITTED" },
  { label: "Verifying", status: "VERIFYING" },
  { label: "Approved", status: "APPROVED" },
  { label: "Processing", status: "PROCESSING" },
  { label: "Escalated", status: "ESCALATED" },
  { label: "Completed", status: "COMPLETED" },
  { label: "Rejected", status: "REJECTED" },
];

const actionPresentation: Readonly<
  Record<
    PrivacyRequestAction,
    { label: string; title: string; consequence: string; icon: LucideIcon }
  >
> = {
  VERIFY: {
    label: "Start verification",
    title: "Start verification?",
    consequence: "Marks the request as being verified. No customer data is changed.",
    icon: ShieldCheck,
  },
  APPROVE: {
    label: "Approve request",
    title: "Approve this request?",
    consequence: "Approves the request for controlled processing. No retained history is deleted.",
    icon: BadgeCheck,
  },
  REJECT: {
    label: "Reject request",
    title: "Reject this request?",
    consequence: "Closes the request as rejected and records the reason for audit.",
    icon: XCircle,
  },
  BEGIN_PROCESSING: {
    label: "Begin processing",
    title: "Begin processing?",
    consequence: "Moves the approved request into processing under the retention policy.",
    icon: Play,
  },
  COMPLETE: {
    label: "Mark completed",
    title: "Complete this request?",
    consequence:
      "Records the request as completed. Required commercial and audit history remains retained.",
    icon: CheckCheck,
  },
  ESCALATE: {
    label: "Escalate",
    title: "Escalate this request?",
    consequence: "Moves the request to specialist review without changing customer data.",
    icon: TriangleAlert,
  },
};

function nextActions(status: PrivacyRequestStatus): ReadonlyArray<PrivacyRequestAction> {
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

function requestTypeLabel(type: PrivacyRequestView["requestType"]): string {
  return {
    ACCESS: "Data access",
    CORRECTION: "Data correction",
    CLOSURE: "Account closure",
    ANONYMIZATION: "Anonymization",
  }[type];
}

function date(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default function PrivacyQueuePage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [page, setPage] = useState<PrivacyRequestPage | null>(null);
  const [status, setStatus] = useState<PrivacyRequestStatus | "">("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const commandIntent = useAdminCommandIntent();
  const pagination = useAdminPagination(status);

  const load = useCallback(async (nextStatus: PrivacyRequestStatus | "", cursor: string | null) => {
    setState({ phase: "loading" });
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (nextStatus) query.set("status", nextStatus);
      if (cursor) query.set("cursor", cursor);
      const payload = (await (
        await fetch(`/api/admin/privacy-requests?${query}`)
      ).json()) as RpcResult<PrivacyRequestPage>;
      if (!payload.ok) {
        setState({
          phase: "error",
          message:
            payload.error.code === "FORBIDDEN"
              ? "Privacy requests require the customers.read capability with a global scope."
              : payload.error.message,
          requestId: payload.error.requestId,
        });
        return;
      }
      setPage(payload.value);
      setState({ phase: "ready" });
    } catch {
      setState({ phase: "error", message: "Network error loading privacy requests." });
    }
  }, []);

  useEffect(() => {
    void load(status, pagination.cursor);
  }, [load, pagination.cursor, status]);

  async function applyAction(reason: string) {
    if (!pendingAction) return;
    const { request, action } = pendingAction;
    try {
      const payload = await commandIntent.submit(async (idempotencyKey) => {
        const response = await fetch(
          `/api/admin/privacy-requests/${encodeURIComponent(request.privacyRequestId)}/actions`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
            body: JSON.stringify({ action, reason, expectedVersion: request.version }),
          },
        );
        return (await response.json()) as RpcResult<unknown>;
      });
      if (!payload.ok) {
        setNotice(payload.error.message);
        return;
      }
      setNotice(`${actionPresentation[action].label} completed.`);
      setPendingAction(null);
      await load(status, pagination.cursor);
    } catch {
      setNotice("Connection lost. Retry the action safely.");
    }
  }

  async function copyRequestId(requestId: string) {
    await navigator.clipboard.writeText(requestId);
    setCopiedId(requestId);
    window.setTimeout(() => {
      setCopiedId((current) => (current === requestId ? null : current));
    }, 2_000);
  }

  const requests = page?.items ?? [];
  const selectedPresentation = pendingAction ? actionPresentation[pendingAction.action] : null;

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader title="Privacy requests" />
      <AdminLiveRegion message={notice} />

      <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white shadow-[var(--fm-shadow-card)]">
        <h2 className="sr-only">Customer privacy requests</h2>
        <div
          className="flex min-h-14 items-end gap-1 overflow-x-auto border-b border-[var(--fm-border)] px-3 pt-2"
          aria-label="Privacy request status views"
        >
          {privacyViews.map((view) => (
            <button
              type="button"
              key={view.label}
              aria-pressed={status === view.status}
              className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                status === view.status
                  ? "border-[var(--fm-text)] text-[var(--fm-text)]"
                  : "border-transparent text-[var(--fm-text-muted)] hover:text-[var(--fm-text)]"
              }`}
              onClick={() => {
                setStatus(view.status);
                pagination.reset();
              }}
            >
              {view.label}
            </button>
          ))}
        </div>

        {copiedId ? (
          <p className="sr-only" role="status">
            Privacy request ID copied.
          </p>
        ) : null}
        {state.phase === "loading" ? (
          <div className="p-4">
            <AdminPageState state="loading" title="Loading privacy requests" />
          </div>
        ) : null}
        {state.phase === "error" ? (
          <div className="p-4">
            <AdminPageState
              state="error"
              title="Privacy requests could not be loaded"
              message={state.message}
              requestId={state.requestId}
              onRetry={() => void load(status, pagination.cursor)}
            />
          </div>
        ) : null}
        {state.phase === "ready" && requests.length === 0 ? (
          <div className="p-4">
            <AdminPageState
              state={status ? "filtered-empty" : "empty"}
              message="No privacy requests are visible in this view."
            />
          </div>
        ) : null}
        {state.phase === "ready" && requests.length > 0 ? (
          <Table aria-label="Customer privacy requests">
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Request</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => {
                const actions = nextActions(request.status);
                return (
                  <TableRow key={request.privacyRequestId}>
                    <TableCell>
                      <Link
                        className="font-medium hover:underline"
                        href={`/admin/customers/${request.customerId}`}
                        prefetch={false}
                      >
                        Customer
                      </Link>
                      <p className="mt-0.5 max-w-44 truncate font-mono text-[11px] text-[var(--fm-text-muted)]">
                        {request.customerId}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-80">
                      <p className="font-medium">{requestTypeLabel(request.requestType)}</p>
                      <p className="mt-0.5 truncate text-xs text-[var(--fm-text-muted)]">
                        {request.reason ?? "No request note provided"}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                      {date(request.requestedAt)}
                    </TableCell>
                    <TableCell>
                      <PrivacyRequestStatusBadge status={request.status} />
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Open actions for ${requestTypeLabel(request.requestType)} request`}
                          >
                            <EllipsisVertical aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/admin/customers/${request.customerId}`} prefetch={false}>
                              <Eye aria-hidden="true" />
                              View customer
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => void copyRequestId(request.privacyRequestId)}
                          >
                            <Clipboard aria-hidden="true" />
                            {copiedId === request.privacyRequestId ? "Copied" : "Copy request ID"}
                          </DropdownMenuItem>
                          {actions.length > 0 ? <DropdownMenuSeparator /> : null}
                          {actions.map((action) => {
                            const presentation = actionPresentation[action];
                            const Icon = presentation.icon;
                            return (
                              <DropdownMenuItem
                                key={action}
                                onSelect={() => setPendingAction({ request, action })}
                              >
                                <Icon aria-hidden="true" />
                                {presentation.label}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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

      {pendingAction && selectedPresentation ? (
        <AdminConfirmationDialog
          open
          title={selectedPresentation.title}
          resource={`${requestTypeLabel(pendingAction.request.requestType)} · Customer ${pendingAction.request.customerId}`}
          scope="Customer privacy request"
          consequence={selectedPresentation.consequence}
          confirmLabel={selectedPresentation.label}
          cancelLabel="Cancel"
          destructive={false}
          pending={commandIntent.pending}
          onCancel={() => setPendingAction(null)}
          onConfirm={(reason) => void applyAction(reason)}
        />
      ) : null}
    </div>
  );
}
