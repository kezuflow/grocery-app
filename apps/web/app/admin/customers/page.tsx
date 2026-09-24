"use client";

import type {
  AdminCustomerPage,
  AdminCustomerSummary,
  CustomerInvitationPage,
  RpcResult,
} from "@freshmarkets/contracts";
import { invitationEmailStatuses } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { MailPlus, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AdminCursorPagination,
  useAdminUrlPagination,
} from "../../../components/admin/admin-controls";
import { AdminLiveRegion, AdminPageState } from "../../../components/admin/admin-page-state";
import { AdminMasterDetailWorkspace } from "../../../components/admin/admin-master-detail-workspace";
import { PageHeader } from "../../../components/admin/admin-shell";
import { CustomerAccessStatusBadge } from "../../../components/admin/customer-status-badges";
import { InvitationEmailStatusText } from "../../../components/admin/invitation-email-status";
import { useAdminCommand } from "../../../components/admin/use-admin-command";
import { useAdminRouteGuard } from "../../../components/admin/use-admin-route-guard";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { useAdminContext, useAdminScopeGuard } from "../admin-context-provider";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId?: string }
  | { phase: "ready" };

const invitationResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.object({
      items: z.array(
        z.object({
          invitationId: z.string(),
          version: z.number().int().positive(),
          email: z.string(),
          emailStatus: z.enum(invitationEmailStatuses),
          status: z.enum(["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"]),
          invitedByStaffId: z.string().nullable(),
          expiresAt: z.string(),
          createdAt: z.string(),
        }),
      ),
      nextCursor: z.string().nullable(),
    }),
  }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);

function date(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default function CustomersPage() {
  const admin = useAdminContext();
  if (admin.state.phase !== "ready") {
    return (
      <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
        <PageHeader title="Customers" />
        <AdminPageState state="loading" title="Loading customers" />
      </section>
    );
  }

  const scopeKey = JSON.stringify(admin.state.selectedScope);
  const canRead =
    admin.state.selectedScope?.kind === "GLOBAL" &&
    admin.state.context.capabilities.includes("customers.read");
  if (!canRead) {
    return (
      <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
        <PageHeader title="Customers" />
        <AdminPageState
          state="error"
          title="Customers are unavailable"
          message="Customer administration requires the customers.read capability with a Global scope."
        />
      </section>
    );
  }

  return (
    <CustomersWorkspace
      key={scopeKey}
      scopeKey={scopeKey}
      canManage={admin.state.context.capabilities.includes("customers.manage")}
    />
  );
}

function CustomersWorkspace({ scopeKey, canManage }: { scopeKey: string; canManage: boolean }) {
  const requestVersion = useRef(0);
  const searchParams = useSearchParams();
  const appliedQuery = searchParams.get("query") ?? "";
  const [query, setQuery] = useState(appliedQuery);
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [customers, setCustomers] = useState<AdminCustomerPage | null>(null);
  const [invitations, setInvitations] = useState<CustomerInvitationPage | null>(null);
  const [invitationLoading, setInvitationLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const invitationCommand = useAdminCommand();
  const pagination = useAdminUrlPagination("/admin/customers");
  const listUrl = `/admin/customers${searchParams.size ? `?${searchParams}` : ""}`;
  const invitationDirty =
    inviteEmail.trim() !== "" ||
    Object.values(revokeReasons).some((reason) => reason.trim() !== "");
  const invitationLocked = invitationCommand.busy || invitationCommand.uncertain;
  useAdminScopeGuard(canManage && invitationDirty, canManage && invitationLocked, () => {
    setInviteEmail("");
    setRevokeReasons({});
    setPanelOpen(false);
  });
  useAdminRouteGuard(canManage && invitationDirty, canManage && invitationLocked);

  useEffect(() => setQuery(appliedQuery), [appliedQuery]);

  function recordHref(customer: AdminCustomerSummary) {
    return `/admin/customers/${encodeURIComponent(customer.customerId)}?returnTo=${encodeURIComponent(listUrl)}&returnScope=${encodeURIComponent(scopeKey)}`;
  }

  function canLeaveInvitation() {
    if (!panelOpen) return true;
    if (invitationLocked) return false;
    return !invitationDirty || window.confirm("Discard the unsaved invitation changes?");
  }

  function closeInvitation() {
    if (!canLeaveInvitation()) return;
    setPanelOpen(false);
    setInviteEmail("");
    setRevokeReasons({});
  }

  function openCustomer(event: React.MouseEvent) {
    if (invitationLocked) {
      event.preventDefault();
      return;
    }
    rememberReturn();
  }

  function rememberReturn() {
    sessionStorage.setItem(
      `freshmarkets.admin.customers.return:${scopeKey}`,
      JSON.stringify({ url: listUrl, y: window.scrollY }),
    );
  }

  useEffect(() => {
    if (state.phase !== "ready") return;
    const key = `freshmarkets.admin.customers.return:${scopeKey}`;
    const stored = sessionStorage.getItem(key);
    if (!stored) return;
    sessionStorage.removeItem(key);
    try {
      const target = JSON.parse(stored) as { url: string; y: number };
      if (target.url === `${window.location.pathname}${window.location.search}` && target.y >= 0) {
        window.requestAnimationFrame(() => window.scrollTo(0, target.y));
      }
    } catch {
      // Invalid return state cannot change the customer list.
    }
  }, [scopeKey, state.phase]);

  const load = useCallback(
    async (search: string, cursor: string | null) => {
      const version = ++requestVersion.current;
      setState({ phase: "loading" });
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (search.trim()) params.set("query", search.trim());
        if (cursor) params.set("cursor", cursor);
        const customerResponse = await fetch(`/api/admin/customers?${params}`);
        const customerPayload = (await customerResponse.json()) as RpcResult<AdminCustomerPage>;
        if (version !== requestVersion.current) return;
        if (!customerPayload.ok) {
          setState({
            phase: "error",
            message:
              customerPayload.error.code === "FORBIDDEN"
                ? "Customer administration requires the customers.read capability with a Global scope."
                : customerPayload.error.message,
            requestId: customerPayload.error.requestId,
          });
          return;
        }
        setCustomers(customerPayload.value);
        setState({ phase: "ready" });
        if (canManage) {
          try {
            const invitationResponse = await fetch("/api/admin/customers/invitations");
            const invitationPayload = invitationResultSchema.parse(await invitationResponse.json());
            if (version !== requestVersion.current) return;
            setInvitations(invitationPayload.ok ? invitationPayload.value : null);
            setNotice(invitationPayload.ok ? null : invitationPayload.error.message);
          } catch {
            if (version === requestVersion.current) {
              setInvitations(null);
              setNotice("Customer invitations could not be loaded. Retry the Customer page.");
            }
          }
        } else {
          setInvitations(null);
          setNotice(null);
        }
      } catch {
        if (version !== requestVersion.current) return;
        setState({ phase: "error", message: "Network error loading customers." });
      }
    },
    [canManage],
  );

  useEffect(() => {
    void load(appliedQuery, pagination.cursor);
    return () => {
      requestVersion.current += 1;
    };
  }, [appliedQuery, load, pagination.cursor]);

  function applySearch(nextQuery: string) {
    if (panelOpen) return;
    const next = new URLSearchParams(searchParams.toString());
    const normalized = nextQuery.trim();
    if (normalized) next.set("query", normalized);
    else next.delete("query");
    pagination.reset(next);
    window.history.pushState(null, "", `/admin/customers${next.size ? `?${next}` : ""}`);
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    if (!inviteEmail.trim()) {
      setNotice("An email is required.");
      return;
    }
    if (
      await invitationCommand.run(
        "create-invitation",
        "/api/admin/customers/invitations",
        { email: inviteEmail.trim() },
        "POST",
        { title: "Customer invitation created" },
      )
    ) {
      setInviteEmail("");
      await load(appliedQuery, pagination.cursor);
    }
  }

  async function loadMoreInvitations() {
    const cursor = invitations?.nextCursor;
    if (!canManage || !cursor || invitationLoading) return;
    setInvitationLoading(true);
    try {
      const response = await fetch(
        `/api/admin/customers/invitations?cursor=${encodeURIComponent(cursor)}`,
      );
      const result = invitationResultSchema.parse(await response.json());
      if (!result.ok) {
        setNotice(result.error.message);
        return;
      }
      setInvitations((previous) =>
        previous?.nextCursor === cursor
          ? {
              items: [...previous.items, ...result.value.items],
              nextCursor: result.value.nextCursor,
            }
          : previous,
      );
      setNotice(null);
    } catch {
      setNotice("More invitations could not be loaded. Please retry.");
    } finally {
      setInvitationLoading(false);
    }
  }

  const visibleCustomers = customers?.items ?? [];
  const master = (
    <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
      <PageHeader
        title="Customers"
        action={
          canManage ? (
            <Button
              type="button"
              size="sm"
              className="fm-admin-reference-primary"
              aria-expanded={panelOpen}
              aria-controls="customer-invitation-panel"
              disabled={panelOpen && invitationLocked}
              onClick={() => (panelOpen ? closeInvitation() : setPanelOpen(true))}
            >
              <MailPlus aria-hidden="true" />
              Invite customer
            </Button>
          ) : undefined
        }
      />
      <AdminLiveRegion message={notice} />
      <AdminLiveRegion message={panelOpen ? null : invitationCommand.notice} />

      <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] shadow-[var(--fm-shadow-card)]">
        <h2 className="sr-only">Customer list</h2>
        <form
          className="flex min-h-14 flex-wrap items-center gap-2 border-b border-[var(--fm-border)] px-4 py-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            applySearch(query);
          }}
        >
          <Input
            aria-label="Search customers"
            placeholder="Search by email"
            value={query}
            disabled={panelOpen}
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 sm:w-72"
          />
          <Button type="submit" size="sm" variant="outline" disabled={panelOpen}>
            Search
          </Button>
          {query || appliedQuery ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={panelOpen}
              onClick={() => {
                setQuery("");
                applySearch("");
              }}
            >
              Clear
            </Button>
          ) : null}
        </form>

        {state.phase === "loading" ? (
          <div className="p-4">
            <AdminPageState state="loading" title="Loading customers" />
          </div>
        ) : null}
        {state.phase === "error" ? (
          <div className="p-4">
            <AdminPageState
              state="error"
              title="Customers could not be loaded"
              message={state.message}
              requestId={state.requestId}
              onRetry={() => void load(appliedQuery, pagination.cursor)}
            />
          </div>
        ) : null}
        {state.phase === "ready" && visibleCustomers.length === 0 ? (
          <div className="p-4">
            <AdminPageState
              state={appliedQuery ? "filtered-empty" : "empty"}
              message="No customers are visible in this view."
            />
          </div>
        ) : null}
        {state.phase === "ready" && visibleCustomers.length > 0 ? (
          <>
            <ul aria-label="Customer list" className="divide-y divide-[var(--fm-border)] sm:hidden">
              {visibleCustomers.map((customer) => (
                <li key={customer.customerId} className="space-y-3 p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={recordHref(customer)}
                        prefetch={false}
                        onClick={openCustomer}
                        className="break-all font-semibold text-[var(--fm-text)] hover:underline"
                      >
                        {customer.email}
                      </Link>
                      <p className="mt-0.5 break-all text-sm text-[var(--fm-text-muted)]">
                        {customer.phone ?? "No phone number"}
                      </p>
                    </div>
                    <CustomerAccessStatusBadge status={customer.accessStatus} />
                  </div>
                  <dl className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-[var(--fm-text-muted)]">Orders</dt>
                      <dd className="mt-0.5 font-medium">{customer.orderCount}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--fm-text-muted)]">Last order</dt>
                      <dd className="mt-0.5">{date(customer.lastOrderAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--fm-text-muted)]">Joined</dt>
                      <dd className="mt-0.5">{date(customer.createdAt)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
              <Table aria-label="Customer list">
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead>Orders</TableHead>
                    <TableHead>Last order</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleCustomers.map((customer) => (
                    <TableRow key={customer.customerId}>
                      <TableCell>
                        <Link
                          href={recordHref(customer)}
                          prefetch={false}
                          onClick={openCustomer}
                          className="break-all font-medium hover:underline"
                        >
                          {customer.email}
                        </Link>
                        <p className="mt-0.5 break-all text-xs text-[var(--fm-text-muted)]">
                          {customer.phone ?? "No phone number"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <CustomerAccessStatusBadge status={customer.accessStatus} />
                      </TableCell>
                      <TableCell className="font-medium">{customer.orderCount}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                        {date(customer.lastOrderAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                        {date(customer.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}

        {state.phase === "ready" ? (
          <AdminCursorPagination
            pageNumber={pagination.pageNumber}
            nextCursor={customers?.nextCursor ?? null}
            pending={panelOpen}
            onPrevious={pagination.previous}
            onNext={pagination.next}
          />
        ) : null}
      </section>
    </section>
  );

  const inviteDetail = canManage ? (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-5">
        <div>
          <h2 id="customer-invitation-title" className="text-xl font-bold tracking-[-0.03em]">
            Invite customer
          </h2>
          <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
            Create and monitor customer invitations.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close customer invitation"
          disabled={invitationLocked}
          onClick={closeInvitation}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <AdminLiveRegion message={invitationCommand.notice} />
        {invitationCommand.uncertain ? (
          <Button
            disabled={invitationCommand.busy}
            onClick={async () => {
              if (await invitationCommand.retry()) await load(appliedQuery, pagination.cursor);
            }}
          >
            Retry unconfirmed action
          </Button>
        ) : null}
        <form className="space-y-4" onSubmit={invite}>
          <label className="grid gap-1.5 text-sm font-medium">
            Email address
            <Input
              placeholder="customer@example.com"
              type="email"
              disabled={invitationCommand.busy || invitationCommand.uncertain}
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
            />
          </label>
          <Button
            type="submit"
            className="fm-admin-reference-primary"
            disabled={invitationCommand.busy || invitationCommand.uncertain}
          >
            {invitationCommand.busy ? "Creating…" : "Create invitation"}
          </Button>
        </form>
        {invitations && invitations.items.length > 0 ? (
          <section
            className="space-y-3 border-t border-[var(--fm-border)] pt-5"
            aria-label="Customer invitations"
          >
            <h3 className="font-semibold">Recent invitations</h3>
            <p className="text-sm text-[var(--fm-text-muted)]">
              Email delivery status and pending invitation controls.
            </p>
            {invitations.items.map((invitation) => (
              <article
                key={invitation.invitationId}
                className="space-y-2 rounded-lg border border-[var(--fm-border)] p-3"
              >
                <p className="break-all font-medium">{invitation.email}</p>
                <p className="text-sm text-[var(--fm-text-muted)]">
                  {invitation.status} · Expires {date(invitation.expiresAt)}
                </p>
                <InvitationEmailStatusText status={invitation.emailStatus} />
                {invitation.status === "PENDING" ? (
                  <fieldset
                    disabled={invitationCommand.busy || invitationCommand.uncertain}
                    className="space-y-2"
                  >
                    <Input
                      aria-label={`Revocation reason for ${invitation.email}`}
                      placeholder="Reason for revocation"
                      maxLength={500}
                      value={revokeReasons[invitation.invitationId] ?? ""}
                      onChange={(event) =>
                        setRevokeReasons((previous) => ({
                          ...previous,
                          [invitation.invitationId]: event.target.value,
                        }))
                      }
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!revokeReasons[invitation.invitationId]?.trim()}
                      onClick={async () => {
                        if (
                          await invitationCommand.run(
                            `revoke:${invitation.invitationId}`,
                            "/api/admin/customers/invitations/revoke",
                            {
                              invitationId: invitation.invitationId,
                              expectedVersion: invitation.version,
                              reason: revokeReasons[invitation.invitationId]?.trim(),
                            },
                            "POST",
                            { title: "Customer invitation revoked" },
                          )
                        ) {
                          setRevokeReasons((previous) => {
                            const next = { ...previous };
                            delete next[invitation.invitationId];
                            return next;
                          });
                          await load(appliedQuery, pagination.cursor);
                        }
                      }}
                    >
                      Revoke invitation
                    </Button>
                  </fieldset>
                ) : null}
              </article>
            ))}
            {invitations.nextCursor ? (
              <Button
                variant="outline"
                disabled={invitationLoading}
                onClick={() => void loadMoreInvitations()}
              >
                {invitationLoading ? "Loading invitations…" : "Load more invitations"}
              </Button>
            ) : null}
          </section>
        ) : null}
      </div>
      <div className="flex shrink-0 justify-end border-t border-[var(--fm-border)] px-5 py-4">
        <Button
          type="button"
          variant="outline"
          disabled={invitationLocked}
          onClick={closeInvitation}
        >
          Close
        </Button>
      </div>
    </>
  ) : null;

  return (
    <AdminMasterDetailWorkspace
      open={canManage && panelOpen}
      master={master}
      detail={inviteDetail}
      detailKey="invite"
      panelId="customer-invitation-panel"
      labelledBy="customer-invitation-title"
      resizeLabel="Resize customer invitation workspace"
    />
  );
}
