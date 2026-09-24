"use client";

import type { AdminMembershipSummary } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { AdminConfirmationDialog } from "../../../../components/admin/admin-controls";
import { AdminLiveRegion, AdminPageState } from "../../../../components/admin/admin-page-state";
import { ListPageSection, PageHeader } from "../../../../components/admin/admin-shell";
import { MembershipStatusBadge } from "../../../../components/admin/customer-status-badges";
import { useAdminCommand } from "../../../../components/admin/use-admin-command";
import { useAdminRouteGuard } from "../../../../components/admin/use-admin-route-guard";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Skeleton } from "../../../../components/ui/skeleton";
import { useAdminContext, useAdminScopeGuard } from "../../admin-context-provider";

type LoadState =
  | { phase: "loading" }
  | {
      phase: "error";
      code: string;
      message: string;
      requestId: string | null;
    }
  | { phase: "ready"; membership: AdminMembershipSummary };

const membershipSummarySchema = z.object({
  subscriptionId: z.string(),
  customerEmail: z.string(),
  state: z.string(),
  cancelAtPeriodEnd: z.boolean(),
  currentPeriodEndsAt: z
    .union([z.string(), z.number()])
    .nullable()
    .transform((value) => (typeof value === "number" ? new Date(value).toISOString() : value)),
  version: z.number().int().positive(),
});

const membershipResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: membershipSummarySchema,
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string().nullable().optional(),
    }),
  }),
]);

function date(value: string | null): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default function MembershipDetailPage({
  params,
}: {
  params: Promise<{ "subscription-id": string }>;
}) {
  const { "subscription-id": subscriptionId } = use(params);
  const admin = useAdminContext();
  if (admin.state.phase !== "ready") {
    return (
      <div className="space-y-3" role="status" aria-label="Loading membership access">
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const canRead =
    admin.state.selectedScope?.kind === "GLOBAL" &&
    admin.state.context.capabilities.includes("memberships.read");
  if (!canRead) {
    return (
      <section className="space-y-5" aria-labelledby="admin-page-title">
        <PageHeader title="Membership unavailable" />
        <AdminPageState
          state="error"
          title="Membership access denied"
          message="Retained membership records require the memberships.read capability with a Global scope."
        />
      </section>
    );
  }

  const scopeKey = JSON.stringify(admin.state.selectedScope);
  return (
    <MembershipDetailWorkspace
      key={`${scopeKey}:${subscriptionId}`}
      subscriptionId={subscriptionId}
      scopeKey={scopeKey}
      canManage={admin.state.context.capabilities.includes("memberships.manage")}
    />
  );
}

function MembershipDetailWorkspace({
  subscriptionId,
  scopeKey,
  canManage,
}: {
  subscriptionId: string;
  scopeKey: string;
  canManage: boolean;
}) {
  const searchParams = useSearchParams();
  const requestedReturn = searchParams.get("returnTo");
  const listHref =
    scopeKey === searchParams.get("returnScope") &&
    requestedReturn &&
    (requestedReturn === "/admin/memberships" || requestedReturn.startsWith("/admin/memberships?"))
      ? requestedReturn
      : "/admin/memberships";
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const cancelTrigger = useRef<HTMLButtonElement>(null);
  const retryTrigger = useRef<HTMLButtonElement>(null);
  const actionFeedback = useRef<HTMLDivElement>(null);
  const restoreTarget = useRef<HTMLElement>(null);
  const command = useAdminCommand();
  const locked = command.busy || command.uncertain;
  useAdminScopeGuard(canManage && reason.trim().length > 0, locked, () => {
    setReason("");
    setConfirming(false);
  });
  useAdminRouteGuard(canManage && reason.trim().length > 0, locked);
  useEffect(() => {
    if (!command.uncertain || confirming) return;
    const frame = requestAnimationFrame(() => retryTrigger.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [command.uncertain, confirming]);

  const load = useCallback(
    (preserveConfirmed = false) => {
      const generation = ++loadGeneration.current;
      if (!preserveConfirmed) setState({ phase: "loading" });
      void (async () => {
        try {
          const response = await fetch(
            `/api/admin/memberships/${encodeURIComponent(subscriptionId)}`,
          );
          const payload = membershipResultSchema.parse(await response.json());
          if (generation !== loadGeneration.current) return;
          if (!payload.ok) {
            if (preserveConfirmed) {
              setRefreshWarning(
                "Cancellation is confirmed, but the latest record could not be refreshed.",
              );
              return;
            }
            setState({
              phase: "error",
              code: payload.error.code,
              message: payload.error.message,
              requestId: payload.error.requestId ?? null,
            });
            return;
          }
          setRefreshWarning(null);
          setState({ phase: "ready", membership: payload.value });
        } catch {
          if (generation !== loadGeneration.current) return;
          if (preserveConfirmed) {
            setRefreshWarning(
              "Cancellation is confirmed, but the latest record could not be refreshed.",
            );
            return;
          }
          setState({
            phase: "error",
            code: "NETWORK_ERROR",
            message: "The membership record could not be loaded. Check the connection and retry.",
            requestId: null,
          });
        }
      })();
    },
    [subscriptionId],
  );

  useEffect(() => {
    load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]);

  function showConfirmedReceipt() {
    const receipt = membershipSummarySchema.safeParse(command.getLastSuccessValue());
    if (!receipt.success) {
      command.setNotice(
        "Cancellation was confirmed, but the returned record could not be displayed. Reload to verify current details.",
      );
      return;
    }
    loadGeneration.current += 1;
    setState({ phase: "ready", membership: receipt.data });
    setReason("");
    load(true);
  }

  async function cancelMembership() {
    if (!canManage || state.phase !== "ready" || !reason.trim()) return;
    const applied = await command.run(
      `membership-cancel:${subscriptionId}`,
      `/api/admin/memberships/${encodeURIComponent(subscriptionId)}/cancel`,
      {
        reason: reason.trim(),
        expectedVersion: state.membership.version,
        timing: "IMMEDIATE",
      },
      "POST",
      { title: "Membership canceled" },
    );
    restoreTarget.current = actionFeedback.current;
    setConfirming(false);
    if (applied) {
      showConfirmedReceipt();
    }
  }

  if (state.phase === "loading") {
    return (
      <div className="space-y-3" role="status" aria-label="Loading membership">
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (state.phase === "error") {
    const title =
      state.code === "NOT_FOUND"
        ? "Membership not found"
        : state.code === "FORBIDDEN"
          ? "Membership access denied"
          : "Membership record unavailable";
    return (
      <section className="space-y-5" aria-labelledby="admin-page-title">
        <Link
          href={listHref}
          className="inline-flex items-center gap-2 text-sm font-medium text-[var(--fm-text-muted)] hover:text-[var(--fm-text)]"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Membership history
        </Link>
        <AdminPageState
          state="error"
          title={title}
          message={state.message}
          requestId={state.requestId ?? undefined}
          onRetry={state.code !== "NOT_FOUND" && state.code !== "FORBIDDEN" ? load : undefined}
        />
      </section>
    );
  }

  const { membership } = state;
  const canCancel = !["CANCELED", "EXPIRED"].includes(membership.state);
  const cancellation =
    membership.state === "CANCELED"
      ? "Canceled"
      : membership.cancelAtPeriodEnd
        ? "Scheduled for period end"
        : "None scheduled";

  return (
    <div className="w-full space-y-6 [&_h1]:break-all">
      <Link
        href={listHref}
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--fm-text-muted)] hover:text-[var(--fm-text)]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Membership history
      </Link>
      <PageHeader
        title={membership.customerEmail}
        description="Retained membership record"
        action={<MembershipStatusBadge status={membership.state} />}
      />

      <div ref={actionFeedback} tabIndex={-1} aria-label="Membership action feedback">
        <AdminLiveRegion message={command.notice} />
        {refreshWarning ? (
          <p role="status" className="text-sm">
            {refreshWarning}
          </p>
        ) : null}
        {command.uncertain ? (
          <Button
            ref={retryTrigger}
            type="button"
            disabled={command.busy}
            onClick={async () => {
              if (await command.retry()) showConfirmedReceipt();
            }}
          >
            Retry unconfirmed cancellation
          </Button>
        ) : null}
      </div>

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <ListPageSection
          title="Membership record"
          description="Current retained lifecycle facts supplied by Core."
        >
          <dl className="grid gap-5 p-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--fm-text-muted)]">Status</dt>
              <dd className="mt-1 font-medium">{membership.state}</dd>
            </div>
            <div>
              <dt className="text-[var(--fm-text-muted)]">Current period ends</dt>
              <dd className="mt-1 font-medium">{date(membership.currentPeriodEndsAt)}</dd>
            </div>
            <div>
              <dt className="text-[var(--fm-text-muted)]">Cancellation</dt>
              <dd className="mt-1 font-medium">{cancellation}</dd>
            </div>
            <div>
              <dt className="text-[var(--fm-text-muted)]">Customer contact</dt>
              <dd className="mt-1 break-all font-medium">{membership.customerEmail}</dd>
            </div>
          </dl>
          <details className="border-t border-[var(--fm-border)] p-5 text-xs text-[var(--fm-text-muted)]">
            <summary className="cursor-pointer font-medium">Technical record details</summary>
            <dl className="mt-3 grid gap-2 break-all">
              <div>
                <dt className="font-medium">Membership ID</dt>
                <dd>{membership.subscriptionId}</dd>
              </div>
              <div>
                <dt className="font-medium">Record version</dt>
                <dd>{membership.version}</dd>
              </div>
            </dl>
          </details>
        </ListPageSection>

        <ListPageSection
          title="Supported action"
          description="New enrollment, pricing and recurring authorization are retired."
        >
          {canManage && canCancel ? (
            <div className="space-y-4 p-5">
              <label className="grid gap-2 text-sm font-medium">
                Cancellation reason
                <Input
                  aria-label="Cancellation reason"
                  placeholder="Required for the audit record"
                  value={reason}
                  maxLength={500}
                  disabled={locked}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <Button
                ref={cancelTrigger}
                type="button"
                variant="destructive"
                disabled={locked || !reason.trim()}
                onClick={() => {
                  restoreTarget.current = cancelTrigger.current;
                  setConfirming(true);
                }}
              >
                Cancel membership
              </Button>
            </div>
          ) : canManage ? (
            <p className="p-5 text-sm text-[var(--fm-text-muted)]">
              This membership is terminal. No lifecycle action is available.
            </p>
          ) : (
            <p className="p-5 text-sm text-[var(--fm-text-muted)]">
              You can review this retained record. Cancellation requires memberships.manage.
            </p>
          )}
        </ListPageSection>
      </div>

      {confirming ? (
        <AdminConfirmationDialog
          open
          title="Cancel this membership immediately?"
          resource={membership.customerEmail}
          scope="Global retained membership"
          consequence="FreshMarkets will mark this retained membership canceled immediately. This does not confirm cancellation of provider-owned billing; historical and financial records remain."
          reasonRequired={false}
          destructive
          confirmLabel="Cancel membership"
          restoreFocusRef={restoreTarget}
          pending={command.busy}
          cancelDisabled={command.uncertain}
          onCancel={() => {
            if (!locked) setConfirming(false);
          }}
          onConfirm={() => void cancelMembership()}
        />
      ) : null}
    </div>
  );
}
