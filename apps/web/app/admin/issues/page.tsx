"use client";

import { appErrorCodes } from "@freshmarkets/contracts";
import type {
  AdminOrderIssuePage,
  AdminOrderIssueSummary,
  OrderIssueAction,
  OrderIssueStatus,
  RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import {
  CheckCircle2,
  Clipboard,
  EllipsisVertical,
  Eye,
  PackageOpen,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminCommandIntent } from "../../../components/admin/admin-command-state";
import { notifyCommandSuccess } from "../../../components/admin/admin-feedback";
import {
  AdminConfirmationDialog,
  AdminCursorPagination,
  AdminIndexViews,
  useAdminUrlPagination,
} from "../../../components/admin/admin-controls";
import { AdminLiveRegion, AdminPageState } from "../../../components/admin/admin-page-state";
import { PageHeader } from "../../../components/admin/admin-shell";
import { useAdminRouteGuard } from "../../../components/admin/use-admin-route-guard";
import { useAdminContext, useAdminScopeGuard } from "../admin-context-provider";
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
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId?: string }
  | { phase: "ready" };

type PendingAction = {
  issue: AdminOrderIssueSummary;
  action: OrderIssueAction;
};

type FrozenIssueIntent = {
  key: string;
  issueId: string;
  action: OrderIssueAction;
  body: string;
};

const commandResultSchema = z.union([
  z.object({ ok: z.literal(true), requestId: z.string(), value: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.enum(appErrorCodes),
      message: z.string(),
      requestId: z.string(),
      details: z.record(z.string(), z.string()).optional(),
    }),
  }),
]);

const issueViews: ReadonlyArray<{ label: string; status: OrderIssueStatus | "" }> = [
  { label: "All", status: "" },
  { label: "New", status: "SUBMITTED" },
  { label: "Being handled", status: "CLAIMED" },
  { label: "Resolved", status: "RESOLVED" },
];

const actionPresentation: Readonly<
  Record<
    OrderIssueAction,
    { label: string; title: string; consequence: string; icon: typeof UserCheck }
  >
> = {
  CLAIM: {
    label: "Start handling",
    title: "Start handling this problem?",
    consequence: "This assigns the issue to you so it can be reviewed.",
    icon: UserCheck,
  },
  RESOLVE: {
    label: "Mark resolved",
    title: "Mark this problem resolved?",
    consequence:
      "Record how this problem was handled. This does not issue a refund or change delivery.",
    icon: CheckCircle2,
  },
};

function date(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
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
  const admin = useAdminContext();
  const scopeKey =
    admin.state.phase === "ready" ? JSON.stringify(admin.state.selectedScope) : "loading";
  const canManage =
    admin.state.phase === "ready" &&
    admin.state.selectedScope?.kind === "GLOBAL" &&
    admin.state.context.capabilities.includes("orders.manage");
  const searchParams = useSearchParams();
  const requestedStatus = searchParams.get("status") ?? "";
  const status = issueViews.some((view) => view.status === requestedStatus)
    ? (requestedStatus as OrderIssueStatus | "")
    : "";
  const listUrl = `/admin/issues${searchParams.size ? `?${searchParams}` : ""}`;
  const requestVersion = useRef(0);
  const retryTrigger = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState<AdminOrderIssuePage | null>(null);
  const [state, setState] = useState<State>({ phase: "loading" });
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [unresolved, setUnresolved] = useState<FrozenIssueIntent | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const commandIntent = useAdminCommandIntent({
    retainConflict: (error) => error.details?.outcome === "RECONCILIATION_PENDING",
  });
  const commandLocked = commandIntent.pending || commandIntent.uncertain || unresolved !== null;
  useAdminScopeGuard(false, commandLocked);
  useAdminRouteGuard(false, commandLocked);
  const pagination = useAdminUrlPagination("/admin/issues");

  useEffect(() => {
    if (!unresolved) return;
    const frame = window.requestAnimationFrame(() => retryTrigger.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [unresolved]);

  function recordHref(issue: AdminOrderIssueSummary) {
    return `/admin/issues/${encodeURIComponent(issue.issueId)}?returnTo=${encodeURIComponent(listUrl)}&returnScope=${encodeURIComponent(scopeKey)}`;
  }

  const load = useCallback(async (nextStatus: OrderIssueStatus | "", cursor: string | null) => {
    const version = ++requestVersion.current;
    setState({ phase: "loading" });
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (nextStatus) query.set("status", nextStatus);
      if (cursor) query.set("cursor", cursor);
      const payload = (await (
        await fetch(`/api/admin/order-issues?${query}`)
      ).json()) as RpcResult<AdminOrderIssuePage>;
      if (version !== requestVersion.current) return;
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
      if (version !== requestVersion.current) return;
      setState({ phase: "error", message: "Network error loading order issues." });
    }
  }, []);

  useEffect(() => {
    void load(status, pagination.cursor);
    return () => {
      requestVersion.current += 1;
    };
  }, [load, pagination.cursor, status]);

  function selectView(nextStatus: OrderIssueStatus | "") {
    if (commandLocked) return;
    const next = new URLSearchParams(searchParams.toString());
    if (nextStatus) next.set("status", nextStatus);
    else next.delete("status");
    pagination.reset(next);
    window.history.pushState(null, "", `/admin/issues${next.size ? `?${next}` : ""}`);
  }

  async function submitIntent(intent: FrozenIssueIntent) {
    if (!canManage || commandIntent.pending) return;
    if (commandIntent.idempotencyKey !== intent.key) {
      setNotice("The request identity changed. Reload Problems before another action.");
      return;
    }
    try {
      const payload = await commandIntent.submit(async (idempotencyKey) => {
        const response = await fetch(
          `/api/admin/order-issues/${encodeURIComponent(intent.issueId)}/actions`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
            body: intent.body,
          },
        );
        return commandResultSchema.parse(await response.json());
      });
      if (
        !payload.ok &&
        payload.error.code === "CONFLICT" &&
        payload.error.details?.outcome === "RECONCILIATION_PENDING"
      ) {
        setUnresolved(intent);
        setPendingAction(null);
        setNotice("The original problem action is still being checked. Retry the same request.");
        return;
      }
      setUnresolved(null);
      setPendingAction(null);
      if (!payload.ok) {
        setNotice(payload.error.message);
        if (payload.error.code === "STALE_VERSION" || payload.error.code === "CONFLICT")
          await load(status, pagination.cursor);
        return;
      }
      setNotice(`${actionPresentation[intent.action].label} completed.`);
      notifyCommandSuccess(`${actionPresentation[intent.action].label} completed`);
      await load(status, pagination.cursor);
    } catch {
      setUnresolved(intent);
      setPendingAction(null);
      setNotice("The action outcome is unknown. Retry the exact same request to confirm it.");
    }
  }

  function applyAction(reason: string) {
    if (!canManage || !pendingAction || commandLocked) return;
    const intent: FrozenIssueIntent = {
      key: commandIntent.idempotencyKey,
      issueId: pendingAction.issue.issueId,
      action: pendingAction.action,
      body: JSON.stringify({
        action: pendingAction.action,
        reason,
        expectedVersion: pendingAction.issue.version,
      }),
    };
    setNotice(null);
    void submitIntent(intent);
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
    <div className="w-full space-y-6">
      <PageHeader title="Problems" />
      <AdminLiveRegion message={notice} />

      {unresolved ? (
        <Alert role="alert" className="border-[var(--fm-warning-border)]">
          <AlertTitle>Problem action awaiting confirmation</AlertTitle>
          <AlertDescription>
            {notice} Keep this problem open until Core returns a final result.
            <Button
              ref={retryTrigger}
              type="button"
              size="sm"
              className="mt-3 block"
              disabled={commandIntent.pending}
              onClick={() => void submitIntent(unresolved)}
            >
              {commandIntent.pending ? "Checking…" : "Retry the same request"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] shadow-[var(--fm-shadow-card)]">
        <h2 className="sr-only">Order issue queue</h2>
        <AdminIndexViews
          label="Order issue status views"
          views={issueViews}
          value={status}
          disabled={commandLocked}
          onChange={selectView}
        />

        {state.phase === "loading" ? (
          <div className="p-4">
            <AdminPageState state="loading" title="Loading order issues" />
          </div>
        ) : null}
        {state.phase === "error" ? (
          <div className="p-4">
            <AdminPageState
              state="error"
              title="Problems could not be loaded"
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
                    {issue.customerPhone && (
                      <a href={`tel:${issue.customerPhone}`} className="text-xs underline">
                        {issue.customerPhone}
                      </a>
                    )}
                  </TableCell>
                  <TableCell className="max-w-72">
                    <Link
                      className="font-medium hover:underline"
                      href={recordHref(issue)}
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
                          disabled={commandLocked}
                          aria-label={`Open actions for ${categoryLabel(issue.category)} issue`}
                        >
                          <EllipsisVertical aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={recordHref(issue)} prefetch={false}>
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
                        {canManage && issue.allowedActions.length > 0 ? (
                          <DropdownMenuSeparator />
                        ) : null}
                        {canManage &&
                          issue.allowedActions.map((action) => {
                            const presentation = actionPresentation[action];
                            const Icon = presentation.icon;
                            return (
                              <DropdownMenuItem
                                key={action}
                                onSelect={() => {
                                  if (!commandLocked) setPendingAction({ issue, action });
                                }}
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
            pending={commandLocked}
            onPrevious={() => {
              if (!commandLocked) pagination.previous();
            }}
            onNext={(cursor) => {
              if (!commandLocked) pagination.next(cursor);
            }}
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
          cancelDisabled={commandLocked}
          maxReasonLength={500}
          onCancel={() => {
            if (!commandLocked) setPendingAction(null);
          }}
          onConfirm={applyAction}
        />
      ) : null}
    </div>
  );
}
