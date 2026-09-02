"use client";

import type {
  AdminOrderIssuePage,
  AdminOrderIssueSummary,
  OrderIssueAction,
  OrderIssueStatus,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  CheckCircle2,
  Clipboard,
  EllipsisVertical,
  Eye,
  PackageOpen,
  Search,
  ShieldAlert,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAdminCommandIntent } from "../../../components/admin/admin-command-state";
import {
  AdminConfirmationDialog,
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";
import { AdminLiveRegion, AdminPageState } from "../../../components/admin/admin-page-state";
import { PageHeader } from "../../../components/admin/admin-shell";
import { OrderIssueStatusBadge } from "../../../components/admin/order-issue-status-badge";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId?: string }
  | { phase: "ready" };

type PendingAction = {
  issue: AdminOrderIssueSummary;
  action: OrderIssueAction;
};

const issueViews: ReadonlyArray<{ label: string; status: OrderIssueStatus | "" }> = [
  { label: "All", status: "" },
  { label: "New", status: "SUBMITTED" },
  { label: "Claimed", status: "CLAIMED" },
  { label: "Investigating", status: "INVESTIGATING" },
  { label: "Escalated", status: "ESCALATED" },
  { label: "Resolved", status: "RESOLVED" },
];

const actionPresentation: Readonly<
  Record<
    OrderIssueAction,
    { label: string; title: string; consequence: string; icon: typeof UserCheck }
  >
> = {
  CLAIM: {
    label: "Claim issue",
    title: "Claim this issue?",
    consequence: "This assigns the issue to you so it can be reviewed.",
    icon: UserCheck,
  },
  BEGIN_INVESTIGATION: {
    label: "Start investigation",
    title: "Start investigating?",
    consequence: "This moves the issue into investigation and assigns it to you.",
    icon: Search,
  },
  RESOLVE: {
    label: "Resolve issue",
    title: "Resolve this issue?",
    consequence: "Resolved issues are final and cannot be reopened. Add a clear resolution note.",
    icon: CheckCircle2,
  },
  ESCALATE: {
    label: "Escalate issue",
    title: "Escalate this issue?",
    consequence: "This marks the issue for additional operational attention.",
    icon: ShieldAlert,
  },
};

function date(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function orderLabel(issue: AdminOrderIssueSummary): string {
  return issue.orderNumber ?? issue.orderId;
}

function categoryLabel(category: string): string {
  return category
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function IssuesPage() {
  const [page, setPage] = useState<AdminOrderIssuePage | null>(null);
  const [state, setState] = useState<State>({ phase: "loading" });
  const [status, setStatus] = useState<OrderIssueStatus | "">("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const commandIntent = useAdminCommandIntent();
  const pagination = useAdminPagination(status);

  const load = useCallback(async (nextStatus: OrderIssueStatus | "", cursor: string | null) => {
    setState({ phase: "loading" });
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (nextStatus) query.set("status", nextStatus);
      if (cursor) query.set("cursor", cursor);
      const payload = (await (
        await fetch(`/api/admin/order-issues?${query}`)
      ).json()) as RpcResult<AdminOrderIssuePage>;
      if (!payload.ok) {
        setState({
          phase: "error",
          message: payload.error.message,
          requestId: payload.error.requestId,
        });
        return;
      }
      setPage(payload.value);
      setState({ phase: "ready" });
    } catch {
      setState({ phase: "error", message: "Network error loading order issues." });
    }
  }, []);

  useEffect(() => {
    void load(status, pagination.cursor);
  }, [load, pagination.cursor, status]);

  async function applyAction(reason: string) {
    if (!pendingAction) return;
    const { issue, action } = pendingAction;
    try {
      const payload = await commandIntent.submit(async (idempotencyKey) => {
        const response = await fetch(
          `/api/admin/order-issues/${encodeURIComponent(issue.issueId)}/actions`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
            body: JSON.stringify({ action, reason, expectedVersion: issue.version }),
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

  async function copyIssueId(issueId: string) {
    await navigator.clipboard.writeText(issueId);
    setCopiedId(issueId);
    window.setTimeout(() => {
      setCopiedId((current) => (current === issueId ? null : current));
    }, 2_000);
  }

  const issues = page?.items ?? [];
  const selectedPresentation = pendingAction ? actionPresentation[pendingAction.action] : null;

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader title="Order issues" />
      <AdminLiveRegion message={notice} />

      <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white shadow-[var(--fm-shadow-card)]">
        <h2 className="sr-only">Order issue queue</h2>
        <div
          className="flex min-h-14 items-end gap-1 overflow-x-auto border-b border-[var(--fm-border)] px-3 pt-2"
          aria-label="Order issue status views"
        >
          {issueViews.map((view) => (
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

        {state.phase === "loading" ? (
          <div className="p-4">
            <AdminPageState state="loading" title="Loading order issues" />
          </div>
        ) : null}
        {state.phase === "error" ? (
          <div className="p-4">
            <AdminPageState
              state="error"
              title="Order issues could not be loaded"
              message={state.message}
              requestId={state.requestId}
              onRetry={() => void load(status, pagination.cursor)}
            />
          </div>
        ) : null}
        {state.phase === "ready" && issues.length === 0 ? (
          <div className="p-4">
            <AdminPageState
              state={status ? "filtered-empty" : "empty"}
              message="No order issues are visible in this view."
            />
          </div>
        ) : null}
        {state.phase === "ready" && issues.length > 0 ? (
          <Table aria-label="Order issue queue">
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead>Reported</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.map((issue) => (
                <TableRow key={issue.issueId}>
                  <TableCell>
                    <Link
                      className="font-medium hover:underline"
                      href={`/admin/orders/${issue.orderId}`}
                      prefetch={false}
                    >
                      {orderLabel(issue)}
                    </Link>
                    {issue.orderNumber ? (
                      <p className="mt-0.5 max-w-40 truncate font-mono text-[11px] text-[var(--fm-text-muted)]">
                        {issue.orderId}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{issue.customerName ?? "Customer"}</p>
                    <p className="text-xs text-[var(--fm-text-muted)]">{issue.customerEmail}</p>
                  </TableCell>
                  <TableCell className="max-w-72">
                    <Link
                      className="font-medium hover:underline"
                      href={`/admin/issues/${issue.issueId}`}
                      prefetch={false}
                    >
                      {categoryLabel(issue.category)}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-[var(--fm-text-muted)]">
                      {issue.details ?? "No details provided"}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                    {date(issue.createdAt)}
                  </TableCell>
                  <TableCell>{issue.assignedStaffName ?? "Unassigned"}</TableCell>
                  <TableCell>
                    <OrderIssueStatusBadge status={issue.status} />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Open actions for ${categoryLabel(issue.category)} issue`}
                        >
                          <EllipsisVertical aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/admin/issues/${issue.issueId}`} prefetch={false}>
                            <Eye aria-hidden="true" />
                            View issue
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/admin/orders/${issue.orderId}`} prefetch={false}>
                            <PackageOpen aria-hidden="true" />
                            View order
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void copyIssueId(issue.issueId)}>
                          <Clipboard aria-hidden="true" />
                          {copiedId === issue.issueId ? "Copied" : "Copy issue ID"}
                        </DropdownMenuItem>
                        {issue.allowedActions.length > 0 ? <DropdownMenuSeparator /> : null}
                        {issue.allowedActions.map((action) => {
                          const presentation = actionPresentation[action];
                          const Icon = presentation.icon;
                          return (
                            <DropdownMenuItem
                              key={action}
                              onSelect={() => setPendingAction({ issue, action })}
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
              ))}
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
          resource={`${categoryLabel(pendingAction.issue.category)} · Order ${orderLabel(pendingAction.issue)}`}
          scope="Customer order issue"
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
