"use client";

import {
  appErrorCodes,
  orderIssueActions,
  orderIssueCategories,
  orderIssueStatuses,
  type AdminOrderIssueDetail,
  type AppError,
  type OrderIssueAction,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminCommandIntent } from "../../../../components/admin/admin-command-state";
import { AdminConfirmationDialog } from "../../../../components/admin/admin-controls";
import { notifyCommandSuccess } from "../../../../components/admin/admin-feedback";
import { AdminLiveRegion, AdminPageState } from "../../../../components/admin/admin-page-state";
import { ListPageSection, PageHeader } from "../../../../components/admin/admin-shell";
import { OrderIssueStatusBadge } from "../../../../components/admin/order-issue-status-badge";
import { useAdminRouteGuard } from "../../../../components/admin/use-admin-route-guard";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { useAdminContext, useAdminScopeGuard } from "../../admin-context-provider";

const actionPresentation: Readonly<
  Record<OrderIssueAction, { label: string; title: string; consequence: string }>
> = {
  CLAIM: {
    label: "Start handling",
    title: "Start handling this problem?",
    consequence: "This assigns the problem to you for support review.",
  },
  RESOLVE: {
    label: "Mark resolved",
    title: "Mark this problem resolved?",
    consequence:
      "Record the support outcome. This does not approve a refund or change the delivery.",
  },
};

const issueViewSchema = z.object({
  issueId: z.string(),
  orderId: z.string(),
  category: z.enum(orderIssueCategories),
  status: z.enum(orderIssueStatuses),
  details: z.string().nullable(),
  assignedStaffId: z.string().nullable(),
  resolution: z.string().nullable(),
  allowedActions: z.array(z.enum(orderIssueActions)),
  version: z.number().int().positive(),
  createdAt: z.string(),
});

const issueDetailSchema = issueViewSchema.extend({
  customerPhone: z.string().nullable(),
  orderNumber: z.string().nullable(),
  customerName: z.string().nullable(),
  customerEmail: z.string(),
  assignedStaffName: z.string().nullable(),
});

const errorSchema = z.object({
  code: z.enum(appErrorCodes),
  message: z.string(),
  requestId: z.string(),
  details: z.record(z.string(), z.string()).optional(),
});

const issueDetailResultSchema = z.union([
  z.object({ ok: z.literal(true), requestId: z.string(), value: issueDetailSchema }),
  z.object({ ok: z.literal(false), error: errorSchema }),
]);

const issueActionResultSchema = z.union([
  z.object({ ok: z.literal(true), requestId: z.string(), value: issueViewSchema }),
  z.object({ ok: z.literal(false), error: errorSchema }),
]);

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready"; issue: AdminOrderIssueDetail };

type FrozenIssueIntent = {
  key: string;
  issueId: string;
  action: OrderIssueAction;
  reason: string;
  expectedVersion: number;
  body: string;
};

const awaitingOriginalIssueOutcome = (error: AppError) =>
  error.code === "CONFLICT" && error.details?.outcome === "RECONCILIATION_PENDING";

function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}

export default function IssueDetailPage({ params }: { params: Promise<{ "issue-id": string }> }) {
  const admin = useAdminContext();
  const searchParams = useSearchParams();
  const requestedReturn = searchParams.get("returnTo");
  const currentScope =
    admin.state.phase === "ready" ? JSON.stringify(admin.state.selectedScope) : null;
  const canManage =
    admin.state.phase === "ready" &&
    admin.state.selectedScope?.kind === "GLOBAL" &&
    admin.state.context.capabilities.includes("orders.manage");
  const listHref =
    currentScope === searchParams.get("returnScope") &&
    requestedReturn &&
    (requestedReturn === "/admin/issues" || requestedReturn.startsWith("/admin/issues?"))
      ? requestedReturn
      : "/admin/issues";
  const [issueId, setIssueId] = useState("");
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<OrderIssueAction | null>(null);
  const [unresolved, setUnresolved] = useState<FrozenIssueIntent | null>(null);
  const requestVersion = useRef(0);
  const actionTrigger = useRef<HTMLButtonElement>(null);
  const retryTrigger = useRef<HTMLButtonElement>(null);
  const commandIntent = useAdminCommandIntent({
    retainConflict: awaitingOriginalIssueOutcome,
  });
  const commandLocked = commandIntent.pending || commandIntent.uncertain || unresolved !== null;
  useAdminScopeGuard(false, commandLocked);
  useAdminRouteGuard(false, commandLocked);

  const load = useCallback(async (id: string, preserveConfirmed = false) => {
    const version = ++requestVersion.current;
    if (!preserveConfirmed) setState({ phase: "loading" });
    try {
      const response = await fetch(`/api/admin/order-issues/${encodeURIComponent(id)}`);
      const result = issueDetailResultSchema.parse(await response.json());
      if (version !== requestVersion.current) return;
      if (!result.ok) {
        if (preserveConfirmed)
          setRefreshWarning(
            `Latest problem record could not be refreshed: ${result.error.message}`,
          );
        else
          setState({
            phase: "error",
            message: result.error.message,
            requestId: result.error.requestId,
          });
        return;
      }
      setRefreshWarning(null);
      setState({ phase: "ready", issue: result.value });
    } catch {
      if (version !== requestVersion.current) return;
      if (preserveConfirmed)
        setRefreshWarning(
          "Latest problem record could not be refreshed. Retry the read to see newer changes.",
        );
      else
        setState({
          phase: "error",
          message: "The problem record could not be loaded. Check the connection and retry.",
          requestId: null,
        });
    }
  }, []);

  useEffect(() => {
    void params.then(({ "issue-id": id }) => {
      setIssueId(id);
      void load(id);
    });
    return () => {
      requestVersion.current += 1;
    };
  }, [load, params]);

  useEffect(() => {
    if (!unresolved) return;
    const frame = window.requestAnimationFrame(() => retryTrigger.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [unresolved]);

  async function submitIntent(intent: FrozenIssueIntent) {
    if (!canManage || commandIntent.pending) return;
    if (commandIntent.idempotencyKey !== intent.key) {
      setNotice(
        "The request identity changed. Reload this problem before starting another action.",
      );
      return;
    }

    try {
      const result = await commandIntent.submit(async (idempotencyKey) => {
        const response = await fetch(
          `/api/admin/order-issues/${encodeURIComponent(intent.issueId)}/actions`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
            body: intent.body,
          },
        );
        return issueActionResultSchema.parse(await response.json());
      });

      if (!result.ok && awaitingOriginalIssueOutcome(result.error)) {
        setUnresolved(intent);
        setPendingAction(null);
        setNotice(
          "The original support action is still being checked. Retry the same request to confirm its outcome.",
        );
        return;
      }

      setUnresolved(null);
      setPendingAction(null);
      setRefreshWarning(null);
      setNotice(
        result.ok ? `${actionPresentation[intent.action].label} completed.` : result.error.message,
      );
      if (result.ok) {
        setState((current) =>
          current.phase === "ready" && current.issue.issueId === intent.issueId
            ? {
                phase: "ready",
                issue: {
                  ...current.issue,
                  ...result.value,
                  assignedStaffName:
                    result.value.assignedStaffId === null
                      ? null
                      : admin.state.phase === "ready" &&
                          result.value.assignedStaffId === admin.state.context.staffId
                        ? admin.state.context.displayName
                        : result.value.assignedStaffId === current.issue.assignedStaffId
                          ? current.issue.assignedStaffName
                          : "Assigned staff",
                },
              }
            : current,
        );
        notifyCommandSuccess(`${actionPresentation[intent.action].label} completed`);
      }
      await load(intent.issueId, result.ok);
    } catch {
      setUnresolved(intent);
      setPendingAction(null);
      setNotice(
        "The support action outcome is unknown. Retry the exact same request to confirm it.",
      );
    }
  }

  function applyAction(reason: string) {
    if (!canManage || state.phase !== "ready" || !pendingAction || commandLocked) return;
    if (!state.issue.allowedActions.includes(pendingAction)) return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) return;
    const intent: FrozenIssueIntent = {
      key: commandIntent.idempotencyKey,
      issueId: state.issue.issueId,
      action: pendingAction,
      reason: trimmedReason,
      expectedVersion: state.issue.version,
      body: JSON.stringify({
        action: pendingAction,
        reason: trimmedReason,
        expectedVersion: state.issue.version,
      }),
    };
    setNotice(null);
    void submitIntent(intent);
  }

  const issue = state.phase === "ready" ? state.issue : null;
  const selectedPresentation = pendingAction ? actionPresentation[pendingAction] : null;
  const orderLabel = issue ? (issue.orderNumber ?? issue.orderId) : "";

  return (
    <div className="mx-auto min-w-0 max-w-[1280px] space-y-6 break-words">
      {unresolved ? (
        <Alert role="alert" className="border-[var(--fm-warning-border)]">
          <AlertTitle>Support action awaiting confirmation</AlertTitle>
          <AlertDescription>
            {notice} The {humanize(unresolved.action).toLowerCase()} note and version are saved for
            this problem until Core returns a final result.
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

      {refreshWarning ? (
        <Alert role="alert" className="border-[var(--fm-warning-border)]">
          <AlertTitle>Action confirmed; latest record unavailable</AlertTitle>
          <AlertDescription>
            {refreshWarning} The confirmed result remains visible below.
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3 block"
              onClick={() => void load(issueId, true)}
            >
              Refresh problem record
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Link
        href={listHref}
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--fm-text-muted)] hover:text-[var(--fm-text)]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Problems
      </Link>

      {state.phase === "loading" ? (
        <AdminPageState state="loading" title="Loading problem" />
      ) : null}
      {state.phase === "error" ? (
        <AdminPageState
          state="error"
          title="Problem could not be loaded"
          message={state.message}
          requestId={state.requestId ?? undefined}
          onRetry={() => void load(issueId)}
        />
      ) : null}
      {issue ? (
        <>
          <PageHeader
            title={humanize(issue.category)}
            description={`Order ${orderLabel} · Reported ${dateTime(issue.createdAt)}`}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <OrderIssueStatusBadge status={issue.status} />
                {canManage &&
                  issue.allowedActions.map((action) => (
                    <Button
                      ref={actionTrigger}
                      key={action}
                      type="button"
                      variant={action === "RESOLVE" ? "default" : "outline"}
                      disabled={commandLocked}
                      onClick={() => setPendingAction(action)}
                    >
                      {actionPresentation[action].label}
                    </Button>
                  ))}
              </div>
            }
          />
          <AdminLiveRegion message={notice} />

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(19rem,1fr)] [&>*]:min-w-0">
            <div className="min-w-0 space-y-6">
              <ListPageSection title="Customer report">
                <div className="p-4 text-sm leading-6 sm:p-5">
                  {issue.details ?? "No details were provided with this report."}
                </div>
              </ListPageSection>

              <ListPageSection
                title="Resolution note"
                description="This records the support outcome only. Refund approval remains a separate Finance action."
              >
                <div className="p-4 text-sm leading-6 sm:p-5">
                  {issue.resolution ?? "No resolution has been recorded."}
                </div>
              </ListPageSection>
            </div>

            <aside className="min-w-0 space-y-6">
              <Card className="gap-4 py-5 shadow-[var(--fm-shadow-card)]">
                <CardHeader className="px-5">
                  <CardTitle>Order context</CardTitle>
                </CardHeader>
                <CardContent className="px-5">
                  <dl className="space-y-4 text-sm">
                    <div>
                      <dt className="text-[var(--fm-text-muted)]">Order</dt>
                      <dd className="mt-1 font-medium">
                        <Link
                          className="hover:underline"
                          href={`/admin/orders/${encodeURIComponent(issue.orderId)}`}
                          prefetch={false}
                        >
                          {orderLabel}
                        </Link>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--fm-text-muted)]">Reported</dt>
                      <dd className="mt-1 font-medium">{dateTime(issue.createdAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--fm-text-muted)]">Owner</dt>
                      <dd className="mt-1 font-medium">
                        {issue.assignedStaffName ?? "Unassigned"}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>

              <Card className="gap-4 py-5 shadow-[var(--fm-shadow-card)]">
                <CardHeader className="px-5">
                  <CardTitle>Customer contact</CardTitle>
                </CardHeader>
                <CardContent className="px-5">
                  <address className="space-y-1 text-sm not-italic">
                    <p className="font-medium">{issue.customerName ?? "Customer"}</p>
                    <a className="block underline" href={`mailto:${issue.customerEmail}`}>
                      {issue.customerEmail}
                    </a>
                    {issue.customerPhone ? (
                      <a className="block underline" href={`tel:${issue.customerPhone}`}>
                        {issue.customerPhone}
                      </a>
                    ) : (
                      <p className="text-[var(--fm-text-muted)]">No phone number recorded</p>
                    )}
                  </address>
                </CardContent>
              </Card>
            </aside>
          </div>

          {pendingAction && selectedPresentation ? (
            <AdminConfirmationDialog
              open
              title={selectedPresentation.title}
              resource={`${humanize(issue.category)} · Order ${orderLabel}`}
              scope="Customer support problem"
              consequence={selectedPresentation.consequence}
              confirmLabel={selectedPresentation.label}
              cancelLabel="Cancel"
              destructive={false}
              pending={commandIntent.pending}
              cancelDisabled={commandLocked}
              maxReasonLength={500}
              restoreFocusRef={actionTrigger}
              onCancel={() => {
                if (!commandLocked) setPendingAction(null);
              }}
              onConfirm={applyAction}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
