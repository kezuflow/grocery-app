"use client";

import type { AdminOrderIssueDetail, OrderIssueAction, RpcResult } from "@freshmarkets/contracts";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAdminCommandIntent } from "../../../../components/admin/admin-command-state";
import { AdminConfirmationDialog } from "../../../../components/admin/admin-controls";
import { AdminLiveRegion, AdminPageState } from "../../../../components/admin/admin-page-state";
import { PageHeader } from "../../../../components/admin/admin-shell";
import { OrderIssueStatusBadge } from "../../../../components/admin/order-issue-status-badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";

const actionPresentation: Readonly<
  Record<OrderIssueAction, { label: string; title: string; consequence: string }>
> = {
  CLAIM: {
    label: "Claim issue",
    title: "Claim this issue?",
    consequence: "This assigns the issue to you so it can be reviewed.",
  },
  BEGIN_INVESTIGATION: {
    label: "Start investigation",
    title: "Start investigating?",
    consequence: "This moves the issue into investigation and assigns it to you.",
  },
  RESOLVE: {
    label: "Resolve issue",
    title: "Resolve this issue?",
    consequence: "Resolved issues are final and cannot be reopened. Add a clear resolution note.",
  },
  ESCALATE: {
    label: "Escalate issue",
    title: "Escalate this issue?",
    consequence: "This marks the issue for additional operational attention.",
  },
};

function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function IssueDetailPage({ params }: { params: Promise<{ "issue-id": string }> }) {
  const [issueId, setIssueId] = useState("");
  const [issue, setIssue] = useState<AdminOrderIssueDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<OrderIssueAction | null>(null);
  const commandIntent = useAdminCommandIntent();

  const load = useCallback(async (id: string) => {
    setState("loading");
    try {
      const result = (await (
        await fetch(`/api/admin/order-issues/${encodeURIComponent(id)}`)
      ).json()) as RpcResult<AdminOrderIssueDetail>;
      if (!result.ok) {
        setNotice(result.error.message);
        setState("error");
        return;
      }
      setIssue(result.value);
      setState("ready");
    } catch {
      setNotice("Network error loading the issue.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    void params.then(({ "issue-id": id }) => {
      setIssueId(id);
      void load(id);
    });
  }, [load, params]);

  async function applyAction(reason: string) {
    if (!issue || !pendingAction) return;
    const action = pendingAction;
    try {
      const result = await commandIntent.submit(async (idempotencyKey) => {
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
      if (!result.ok) {
        setNotice(result.error.message);
        return;
      }
      setNotice(`${actionPresentation[action].label} completed.`);
      setPendingAction(null);
      await load(issue.issueId);
    } catch {
      setNotice("Connection lost. Retry the action safely.");
    }
  }

  const selectedPresentation = pendingAction ? actionPresentation[pendingAction] : null;

  return (
    <div className="mx-auto max-w-[1000px] space-y-6">
      <Link
        href="/admin/issues"
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--fm-text-muted)] hover:text-[var(--fm-text)]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Order issues
      </Link>

      {state === "loading" ? <AdminPageState state="loading" title="Loading issue" /> : null}
      {state === "error" ? (
        <AdminPageState
          state="error"
          title="Issue could not be loaded"
          message={notice ?? undefined}
          onRetry={() => void load(issueId)}
        />
      ) : null}
      {state === "ready" && issue ? (
        <>
          <PageHeader
            title={humanize(issue.category)}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <OrderIssueStatusBadge status={issue.status} />
                {issue.allowedActions.map((action) => (
                  <Button
                    key={action}
                    type="button"
                    variant={action === "RESOLVE" ? "default" : "outline"}
                    disabled={commandIntent.pending}
                    onClick={() => setPendingAction(action)}
                  >
                    {actionPresentation[action].label}
                  </Button>
                ))}
              </div>
            }
          />
          <AdminLiveRegion message={notice} />

          <Card className="gap-4 py-5 shadow-[var(--fm-shadow-card)]">
            <CardHeader className="px-5">
              <CardTitle>Issue details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 px-5 sm:grid-cols-2">
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-[var(--fm-text-muted)]">Order</dt>
                  <dd className="mt-1 font-medium">
                    <Link className="hover:underline" href={`/admin/orders/${issue.orderId}`}>
                      {issue.orderNumber ?? issue.orderId}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--fm-text-muted)]">Reported</dt>
                  <dd className="mt-1 font-medium">{dateTime(issue.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--fm-text-muted)]">Owner</dt>
                  <dd className="mt-1 font-medium">{issue.assignedStaffName ?? "Unassigned"}</dd>
                </div>
                <div>
                  <dt className="text-[var(--fm-text-muted)]">Customer</dt>
                  <dd className="mt-1 font-medium">{issue.customerName ?? "Customer"}</dd>
                  <dd className="text-[var(--fm-text-muted)]">{issue.customerEmail}</dd>
                </div>
              </dl>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-[var(--fm-text-muted)]">Customer report</dt>
                  <dd className="mt-1">{issue.details ?? "No details provided."}</dd>
                </div>
                <div>
                  <dt className="text-[var(--fm-text-muted)]">Resolution</dt>
                  <dd className="mt-1">{issue.resolution ?? "Pending"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {pendingAction && selectedPresentation ? (
            <AdminConfirmationDialog
              open
              title={selectedPresentation.title}
              resource={`${humanize(issue.category)} · ${issue.issueId}`}
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
        </>
      ) : null}
    </div>
  );
}
