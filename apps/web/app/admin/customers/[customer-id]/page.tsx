"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { appErrorCodes, type AdminCustomerDetail } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AdminConfirmationDialog } from "../../../../components/admin/admin-controls";
import { AdminPageState } from "../../../../components/admin/admin-page-state";
import { ListPageSection, PageHeader, StatusBadge } from "../../../../components/admin/admin-shell";
import { CustomerPrivacyPanel } from "../../../../components/admin/customer-privacy-panel";
import { CustomerSupportPanel } from "../../../../components/admin/customer-support-panel";
import { useAdminCommand } from "../../../../components/admin/use-admin-command";
import { useAdminRouteGuard } from "../../../../components/admin/use-admin-route-guard";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Skeleton } from "../../../../components/ui/skeleton";
import { useAdminContext, useAdminScopeGuard } from "../../admin-context-provider";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; code: string; message: string; requestId: string | null }
  | { phase: "ready"; customer: AdminCustomerDetail };

type ConsequentialAction = "DISABLE" | "RESTORE" | "REVOKE_SESSIONS";

const customerResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.object({
      customerId: z.string(),
      authUserId: z.string(),
      email: z.string(),
      phone: z.string().nullable(),
      accessStatus: z.enum(["active", "disabled"]),
      subscriptionState: z.string().nullable(),
      orderCount: z.number().int().nonnegative(),
      lastOrderAt: z.string().nullable(),
      version: z.number().int().positive(),
      createdAt: z.string(),
      recentAudit: z.array(
        z.object({
          auditEventId: z.string(),
          occurredAt: z.string(),
          actorId: z.string().nullable(),
          action: z.string(),
          resourceType: z.string(),
          resourceId: z.string(),
          marketId: z.string().nullable(),
          locationId: z.string().nullable(),
          reason: z.string().nullable(),
          correlationId: z.string().nullable(),
        }),
      ),
    }),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.enum(appErrorCodes),
      message: z.string(),
      requestId: z.string(),
    }),
  }),
]);

function date(value: string | null): string {
  if (!value) return "None recorded";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ "customer-id": string }>;
}) {
  const admin = useAdminContext();
  const { "customer-id": customerId } = use(params);

  if (admin.state.phase !== "ready") {
    return <AdminPageState state="loading" title="Loading customer access" />;
  }

  const canRead =
    admin.state.selectedScope?.kind === "GLOBAL" &&
    admin.state.context.capabilities.includes("customers.read");
  if (!canRead) {
    return (
      <section className="space-y-5" aria-labelledby="admin-page-title">
        <PageHeader title="Customer unavailable" />
        <AdminPageState
          state="error"
          title="Customer access denied"
          message="Customer records require the customers.read capability with a Global scope."
        />
      </section>
    );
  }

  const scopeKey = JSON.stringify(admin.state.selectedScope);
  return (
    <CustomerDetailWorkspace
      key={`${scopeKey}:${customerId}`}
      customerId={customerId}
      scopeKey={scopeKey}
      canManage={admin.state.context.capabilities.includes("customers.manage")}
    />
  );
}

function CustomerDetailWorkspace({
  customerId,
  scopeKey,
  canManage,
}: {
  customerId: string;
  scopeKey: string;
  canManage: boolean;
}) {
  const searchParams = useSearchParams();
  const requestedReturn = searchParams.get("returnTo");
  const listHref =
    scopeKey === searchParams.get("returnScope") &&
    requestedReturn &&
    (requestedReturn === "/admin/customers" || requestedReturn.startsWith("/admin/customers?"))
      ? requestedReturn
      : "/admin/customers";
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState<ConsequentialAction | null>(null);
  const command = useAdminCommand();
  const { notice } = command;
  const loadGeneration = useRef(0);
  const accessTrigger = useRef<HTMLButtonElement>(null);
  const sessionTrigger = useRef<HTMLButtonElement>(null);
  const locked = command.busy || command.uncertain;
  useAdminScopeGuard(canManage && reason.trim().length > 0, locked, () => {
    setReason("");
    setConfirming(null);
  });
  useAdminRouteGuard(canManage && reason.trim().length > 0, locked);

  const load = useCallback(() => {
    const generation = ++loadGeneration.current;
    setState({ phase: "loading" });
    void (async () => {
      try {
        const response = await fetch(`/api/admin/customers/${encodeURIComponent(customerId)}`);
        const payload = customerResultSchema.parse(await response.json());
        if (generation !== loadGeneration.current) return;
        if (!payload.ok) {
          setState({
            phase: "error",
            code: payload.error.code,
            message: payload.error.message,
            requestId: payload.error.requestId,
          });
          return;
        }
        setState({ phase: "ready", customer: payload.value });
      } catch {
        if (generation !== loadGeneration.current) return;
        setState({
          phase: "error",
          code: "NETWORK_ERROR",
          message: "The customer record could not be loaded. Check the connection and retry.",
          requestId: null,
        });
      }
    })();
  }, [customerId]);

  useEffect(() => {
    load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]);

  async function run(action: ConsequentialAction, confirmedReason: string) {
    if (!canManage || state.phase !== "ready") return;
    const customer = state.customer;
    const accessAction = action === "DISABLE" || action === "RESTORE";
    const applied = await command.run(
      accessAction ? `customer-access:${customerId}` : `customer-sessions:${customerId}`,
      accessAction
        ? `/api/admin/customers/${encodeURIComponent(customerId)}/access`
        : `/api/admin/customers/${encodeURIComponent(customerId)}/sessions/revoke`,
      accessAction
        ? { action, reason: confirmedReason, expectedVersion: customer.version }
        : { reason: confirmedReason },
      "POST",
      {
        title:
          action === "DISABLE"
            ? "Customer access disabled"
            : action === "RESTORE"
              ? "Customer access restored"
              : "Customer sessions revoked",
      },
    );
    setConfirming(null);
    if (applied) {
      setReason("");
      load();
    }
  }

  if (state.phase === "loading") {
    return (
      <div className="space-y-3" role="status" aria-label="Loading customer">
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (state.phase === "error") {
    const title =
      state.code === "NOT_FOUND"
        ? "Customer not found"
        : state.code === "FORBIDDEN"
          ? "Customer access denied"
          : "Customer record unavailable";
    return (
      <section className="space-y-5" aria-labelledby="admin-page-title">
        <Link
          href={listHref}
          className="inline-flex items-center gap-2 text-sm font-medium text-[var(--fm-text-muted)] hover:text-[var(--fm-text)]"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Customers
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

  const { customer } = state;
  const pendingAction = confirming;
  const confirmation = pendingAction
    ? pendingAction === "DISABLE"
      ? {
          title: "Disable customer access?",
          consequence:
            "The customer will lose checkout and account commerce access. Existing Orders and financial records stay unchanged.",
          label: "Disable access",
          destructive: true,
        }
      : pendingAction === "RESTORE"
        ? {
            title: "Restore customer access?",
            consequence:
              "The customer can use commerce account surfaces again. Existing Orders and retained records stay unchanged.",
            label: "Restore access",
            destructive: false,
          }
        : {
            title: "Revoke customer sessions?",
            consequence:
              "Current reviewed sessions will be signed out. This does not disable commerce access or change Orders and financial records.",
            label: "Revoke sessions",
            destructive: true,
          }
    : null;

  return (
    <div className="w-full space-y-6 [&_h1]:break-all">
      <Link
        href={listHref}
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--fm-text-muted)] hover:text-[var(--fm-text)]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Customers
      </Link>
      <PageHeader
        title={customer.email}
        description={`Customer since ${date(customer.createdAt)}`}
        action={
          <StatusBadge tone={customer.accessStatus === "active" ? "success" : "danger"}>
            {customer.accessStatus === "active" ? "Active" : "Access disabled"}
          </StatusBadge>
        }
      />

      {notice ? (
        <p
          role="status"
          className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-3 text-sm"
        >
          {notice}
        </p>
      ) : null}

      {command.uncertain ? (
        <Button
          disabled={command.busy}
          onClick={async () => {
            if (await command.retry()) {
              setConfirming(null);
              setReason("");
              load();
            }
          }}
        >
          Retry unconfirmed action
        </Button>
      ) : null}

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="min-w-0 space-y-6">
          <CustomerSupportPanel
            customerId={customerId}
            command={command}
            canManage={canManage}
            onChanged={load}
          />
          <CustomerPrivacyPanel
            customerId={customerId}
            command={command}
            canManage={canManage}
            onChanged={load}
          />
          <ListPageSection
            title="Recent activity"
            description="Sanitized material changes recorded for this customer."
          >
            {customer.recentAudit.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]">
                No material history recorded.
              </p>
            ) : (
              <ol className="divide-y divide-[var(--fm-border)]">
                {customer.recentAudit.map((event) => (
                  <li key={event.auditEventId} className="space-y-2 p-5 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{event.action}</strong>
                      <time dateTime={event.occurredAt}>{date(event.occurredAt)}</time>
                    </div>
                    {event.reason ? (
                      <p className="whitespace-pre-wrap break-words text-[var(--fm-text-muted)]">
                        {event.reason}
                      </p>
                    ) : null}
                    <details className="text-xs text-[var(--fm-text-muted)]">
                      <summary className="cursor-pointer font-medium">Technical evidence</summary>
                      <dl className="mt-2 grid gap-1 break-all">
                        <div>
                          <dt className="inline font-medium">Resource: </dt>
                          <dd className="inline">
                            {event.resourceType}:{event.resourceId}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline font-medium">Audit event: </dt>
                          <dd className="inline">{event.auditEventId}</dd>
                        </div>
                      </dl>
                    </details>
                  </li>
                ))}
              </ol>
            )}
          </ListPageSection>
        </div>

        <aside className="min-w-0 space-y-6">
          <ListPageSection title="Contact" description="Current account contact details.">
            <dl className="grid gap-4 p-5 text-sm">
              <div className="min-w-0">
                <dt className="text-[var(--fm-text-muted)]">Email</dt>
                <dd className="break-all font-medium">{customer.email}</dd>
              </div>
              <div>
                <dt className="text-[var(--fm-text-muted)]">Phone</dt>
                <dd>{customer.phone ?? "None recorded"}</dd>
              </div>
            </dl>
          </ListPageSection>

          <ListPageSection title="Customer summary" description="Current account and order facts.">
            <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
              <div>
                <dt className="text-[var(--fm-text-muted)]">Orders</dt>
                <dd className="text-lg font-semibold">{customer.orderCount}</dd>
              </div>
              <div>
                <dt className="text-[var(--fm-text-muted)]">Last order</dt>
                <dd>{date(customer.lastOrderAt)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[var(--fm-text-muted)]">Legacy membership</dt>
                <dd>{customer.subscriptionState ?? "No membership history"}</dd>
              </div>
            </dl>
            <details className="border-t border-[var(--fm-border)] p-5 text-xs text-[var(--fm-text-muted)]">
              <summary className="cursor-pointer font-medium">Technical account details</summary>
              <dl className="mt-3 grid gap-2 break-all">
                <div>
                  <dt className="font-medium">Customer ID</dt>
                  <dd>{customer.customerId}</dd>
                </div>
                <div>
                  <dt className="font-medium">Record version</dt>
                  <dd>{customer.version}</dd>
                </div>
              </dl>
            </details>
          </ListPageSection>

          <ListPageSection
            title="Commerce access"
            description="Access and session changes require a recorded reason."
          >
            {canManage ? (
              <div className="space-y-4 p-5">
                <label className="grid gap-2 text-sm font-medium">
                  Reason
                  <Input
                    aria-label="Reason"
                    placeholder="Required for access actions"
                    value={reason}
                    maxLength={500}
                    disabled={locked}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <div className="grid gap-2">
                  <Button
                    ref={accessTrigger}
                    variant={customer.accessStatus === "active" ? "destructive" : "default"}
                    disabled={locked || !reason.trim()}
                    onClick={() =>
                      setConfirming(customer.accessStatus === "active" ? "DISABLE" : "RESTORE")
                    }
                  >
                    {customer.accessStatus === "active" ? "Disable access" : "Restore access"}
                  </Button>
                  <Button
                    ref={sessionTrigger}
                    variant="outline"
                    disabled={locked || !reason.trim()}
                    onClick={() => setConfirming("REVOKE_SESSIONS")}
                  >
                    Revoke sessions
                  </Button>
                </div>
              </div>
            ) : (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]">
                You can review this record. Customer access and session actions require
                customers.manage.
              </p>
            )}
          </ListPageSection>
        </aside>
      </div>

      {confirmation && pendingAction ? (
        <AdminConfirmationDialog
          open
          title={confirmation.title}
          resource={customer.email}
          scope="Global customer account"
          consequence={confirmation.consequence}
          initialReason={reason}
          maxReasonLength={500}
          destructive={confirmation.destructive}
          confirmLabel={confirmation.label}
          restoreFocusRef={pendingAction === "REVOKE_SESSIONS" ? sessionTrigger : accessTrigger}
          pending={command.busy}
          cancelDisabled={command.uncertain}
          onCancel={() => {
            if (!locked) setConfirming(null);
          }}
          onConfirm={(confirmedReason) => {
            setReason(confirmedReason);
            void run(pendingAction, confirmedReason);
          }}
        />
      ) : null}
    </div>
  );
}
