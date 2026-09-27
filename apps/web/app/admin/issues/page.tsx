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
  Circle,
  Clipboard,
  Clock3,
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
import { useAdminRouteGuard } from "../../../components/admin/use-admin-route-guard";
import { useAdminContext, useAdminScopeGuard } from "../admin-context-provider";
import { Button } from "@/components/admin/shadcn/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/admin/shadcn/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/admin/shadcn/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/admin/shadcn/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/admin/shadcn/alert";

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

function IssueProgressStatus({ status }: { status: OrderIssueStatus }) {
  const label =
    status === "SUBMITTED" ? "New" : status === "RESOLVED" ? "Resolved" : "Being handled";
  const Icon = status === "SUBMITTED" ? Circle : status === "RESOLVED" ? CheckCircle2 : Clock3;

  return (
    <span className="inline-flex items-center gap-2 text-sm whitespace-nowrap">
      <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
      {label}
    </span>
  );
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

  function issueActions(issue: AdminOrderIssueSummary) {
    return (
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
          {canManage && issue.allowedActions.length > 0 ? <DropdownMenuSeparator /> : null}
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
    );
  }

  const issues = page?.items ?? [];
  const selectedPresentation = pendingAction ? actionPresentation[pendingAction.action] : null;

  return (
    <div className="fm-admin-task-index w-full">
      <AdminLiveRegion message={notice} />

      <Card className="gap-0 overflow-hidden border-border py-0 shadow-none">
        <CardHeader className="gap-1 px-4 pt-6 pb-5 sm:px-6 sm:pt-8 sm:pb-7">
          <CardTitle>
            <h1 id="admin-page-title" className="text-2xl font-semibold tracking-tight">
              Problems
            </h1>
          </CardTitle>
          <CardDescription>Review and manage order problems.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-4 pb-4 sm:px-6">
          {unresolved ? (
            <Alert role="alert" className="border-border">
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

          <AdminIndexViews
            label="Order issue status views"
            views={issueViews}
            value={status}
            disabled={commandLocked}
            onChange={selectView}
          />

          <section className="overflow-hidden rounded-md border border-border">
            <h2 className="sr-only">Order issue queue</h2>
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
              <div>
                <ul aria-label="Order issue list" className="divide-y divide-border xl:hidden">
                  {issues.map((issue) => (
                    <li key={issue.issueId} className="flex flex-col gap-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col gap-1">
                          <Link
                            className="font-semibold hover:underline"
                            href={`/admin/orders/${issue.orderId}`}
                            prefetch={false}
                          >
                            {orderLabel(issue)}
                          </Link>
                          <span className="truncate text-sm text-muted-foreground">
                            {issue.customerName ?? issue.customerEmail}
                          </span>
                        </div>
                        {issueActions(issue)}
                      </div>
                      <div className="flex min-w-0 flex-col gap-1">
                        <Link
                          className="font-medium hover:underline"
                          href={recordHref(issue)}
                          prefetch={false}
                        >
                          {categoryLabel(issue.category)}
                        </Link>
                        {issue.details ? (
                          <p
                            className="truncate text-sm text-muted-foreground"
                            title={issue.details}
                          >
                            {issue.details}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <IssueProgressStatus status={issue.status} />
                        <span className="text-sm text-muted-foreground">
                          {date(issue.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Owner: {issue.assignedStaffName ?? "Unassigned"}
                      </p>
                    </li>
                  ))}
                </ul>
                <div className="hidden xl:block">
                  <Table aria-label="Order issue queue" className="table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[15%]">Order ID</TableHead>
                        <TableHead className="w-[15%]">Customer</TableHead>
                        <TableHead className="w-1/4">Issue</TableHead>
                        <TableHead className="w-[12%]">Reported</TableHead>
                        <TableHead className="w-[11%]">Owner</TableHead>
                        <TableHead className="w-[17%]">Status</TableHead>
                        <TableHead className="w-[5%]">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {issues.map((issue) => (
                        <TableRow key={issue.issueId} className="h-12 border-border">
                          <TableCell>
                            <Link
                              className="font-medium hover:underline"
                              href={`/admin/orders/${issue.orderId}`}
                              prefetch={false}
                            >
                              {orderLabel(issue)}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <span className="font-medium">
                              {issue.customerName ?? issue.customerEmail}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-72">
                            <div className="flex min-w-0 items-center gap-2">
                              <Link
                                className="shrink-0 font-medium hover:underline"
                                href={recordHref(issue)}
                                prefetch={false}
                              >
                                {categoryLabel(issue.category)}
                              </Link>
                              {issue.details ? (
                                <span
                                  className="truncate text-muted-foreground"
                                  title={issue.details}
                                >
                                  {issue.details}
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {date(issue.createdAt)}
                          </TableCell>
                          <TableCell>{issue.assignedStaffName ?? "Unassigned"}</TableCell>
                          <TableCell>
                            <IssueProgressStatus status={issue.status} />
                          </TableCell>
                          <TableCell>{issueActions(issue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}
          </section>
        </CardContent>
        {state.phase === "ready" ? (
          <CardFooter className="flex-col items-start gap-1 px-4 pt-2 pb-5 sm:flex-row sm:justify-between sm:px-6">
            <span className="text-sm text-muted-foreground">
              Showing {issues.length} of {issues.length}{" "}
              {issues.length === 1 ? "problem" : "problems"} on this page
            </span>
            <AdminCursorPagination
              compact
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
          </CardFooter>
        ) : null}
      </Card>

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
