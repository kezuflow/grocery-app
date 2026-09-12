"use client";

import type {
  AdminCustomerPage,
  AdminCustomerSummary,
  CustomerInvitationPage,
  RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { invitationEmailStatuses } from "@freshmarkets/contracts";
import { InvitationEmailStatusText } from "../../../components/admin/invitation-email-status";
import { Clipboard, EllipsisVertical, ExternalLink, Eye, MailPlus, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";
import { useAdminCommand } from "../../../components/admin/use-admin-command";
import { CustomerAccessStatusBadge } from "../../../components/admin/customer-status-badges";
import { AdminLiveRegion, AdminPageState } from "../../../components/admin/admin-page-state";
import { AdminMasterDetailWorkspace } from "../../../components/admin/admin-master-detail-workspace";
import { PageHeader } from "../../../components/admin/admin-shell";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Input } from "../../../components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";

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

function customerLabel(customer: AdminCustomerSummary): string {
  return customer.email || customer.customerId;
}

export default function CustomersPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [customers, setCustomers] = useState<AdminCustomerPage | null>(null);
  const [invitations, setInvitations] = useState<CustomerInvitationPage | null>(null);
  const [invitationLoading, setInvitationLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<"invite" | "customer">("invite");
  const [selectedCustomer, setSelectedCustomer] = useState<AdminCustomerSummary | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const invitationCommand = useAdminCommand();
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const pagination = useAdminPagination(appliedQuery);

  const load = useCallback(async (search: string, cursor: string | null) => {
    setState({ phase: "loading" });
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (search.trim()) params.set("query", search.trim());
      if (cursor) params.set("cursor", cursor);
      const [customerResponse, invitationResponse] = await Promise.all([
        fetch(`/api/admin/customers?${params}`),
        fetch("/api/admin/customers/invitations"),
      ]);
      const customerPayload = (await customerResponse.json()) as RpcResult<AdminCustomerPage>;
      if (!customerPayload.ok) {
        setState({
          phase: "error",
          message:
            customerPayload.error.code === "FORBIDDEN"
              ? "Customer administration requires the customers.read capability with a global scope."
              : customerPayload.error.message,
          requestId: customerPayload.error.requestId,
        });
        return;
      }
      const invitationPayload = invitationResultSchema.parse(await invitationResponse.json());
      setCustomers(customerPayload.value);
      setInvitations(invitationPayload.ok ? invitationPayload.value : null);
      if (!invitationPayload.ok) setNotice(invitationPayload.error.message);
      setSelectedIds(new Set());
      setState({ phase: "ready" });
    } catch {
      setState({ phase: "error", message: "Network error loading customers." });
    }
  }, []);

  useEffect(() => {
    void load(appliedQuery, pagination.cursor);
  }, [appliedQuery, load, pagination.cursor]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (!inviteEmail.trim()) {
      setNotice("An email is required.");
      return;
    }
    if (
      await invitationCommand.run("create-invitation", "/api/admin/customers/invitations", {
        email: inviteEmail.trim(),
      })
    ) {
      setInviteEmail("");
      await load(appliedQuery, pagination.cursor);
    }
  }

  function selectCustomer(customerId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(customerId);
      else next.delete(customerId);
      return next;
    });
  }

  async function loadMoreInvitations() {
    const cursor = invitations?.nextCursor;
    if (!cursor || invitationLoading) return;
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
    } catch {
      setNotice("More invitations could not be loaded. Please retry.");
    } finally {
      setInvitationLoading(false);
    }
  }

  async function copyCustomerId(customer: AdminCustomerSummary) {
    await navigator.clipboard.writeText(customer.customerId);
    setCopiedId(customer.customerId);
    window.setTimeout(() => {
      setCopiedId((current) => (current === customer.customerId ? null : current));
    }, 2_000);
  }

  const visibleCustomers = customers?.items ?? [];
  const allSelected = visibleCustomers.length > 0 && selectedIds.size === visibleCustomers.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const master = (
    <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
      <PageHeader
        title="Customers"
        action={
          <Button
            type="button"
            size="sm"
            className="fm-admin-reference-primary"
            aria-expanded={panelOpen && panelMode === "invite"}
            aria-controls="customer-detail-panel"
            onClick={() => {
              setPanelMode("invite");
              setPanelOpen((open) => (panelMode === "invite" ? !open : true));
            }}
          >
            <MailPlus aria-hidden="true" />
            Invite customer
          </Button>
        }
      />
      <AdminLiveRegion message={notice} />
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

      <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] shadow-[var(--fm-shadow-card)]">
        <h2 className="sr-only">Customer list</h2>
        {selectedIds.size > 0 ? (
          <div className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--fm-border)] px-4 py-2.5">
            <p className="text-sm font-medium" role="status" aria-live="polite">
              {selectedIds.size} selected
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSelectedIds(new Set())}
            >
              <X aria-hidden="true" />
              Clear selection
            </Button>
          </div>
        ) : (
          <form
            className="flex min-h-14 flex-wrap items-center gap-2 border-b border-[var(--fm-border)] px-4 py-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              setAppliedQuery(query.trim());
              pagination.reset();
            }}
          >
            <Input
              aria-label="Search customers"
              placeholder="Search by email"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 sm:w-72"
            />
            <Button type="submit" size="sm" variant="outline">
              Search
            </Button>
            {query || appliedQuery ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setQuery("");
                  setAppliedQuery("");
                  pagination.reset();
                }}
              >
                Clear
              </Button>
            ) : null}
          </form>
        )}

        {copiedId ? (
          <p className="sr-only" role="status">
            Customer ID copied.
          </p>
        ) : null}
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
          <Table aria-label="Customer list">
            <TableHeader>
              <TableRow>
                <TableHead className="w-11">
                  <Checkbox
                    aria-label="Select all customers on this page"
                    checked={someSelected ? "indeterminate" : allSelected}
                    onCheckedChange={(checked) =>
                      setSelectedIds(
                        checked === true
                          ? new Set(visibleCustomers.map((customer) => customer.customerId))
                          : new Set(),
                      )
                    }
                  />
                </TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Membership</TableHead>
                <TableHead>Orders</TableHead>
                <TableHead>Last order</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleCustomers.map((customer) => (
                <TableRow
                  key={customer.customerId}
                  data-state={selectedIds.has(customer.customerId) ? "selected" : undefined}
                >
                  <TableCell>
                    <Checkbox
                      aria-label={`Select customer ${customerLabel(customer)}`}
                      checked={selectedIds.has(customer.customerId)}
                      onCheckedChange={(checked) =>
                        selectCustomer(customer.customerId, checked === true)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      aria-expanded={
                        panelOpen &&
                        panelMode === "customer" &&
                        selectedCustomer?.customerId === customer.customerId
                      }
                      aria-controls="customer-detail-panel"
                      className="font-medium hover:underline"
                      onClick={() => {
                        setSelectedCustomer(customer);
                        setPanelMode("customer");
                        setPanelOpen(true);
                      }}
                    >
                      {customer.email}
                    </button>
                    <p className="mt-0.5 text-xs text-[var(--fm-text-muted)]">
                      {customer.phone ?? customer.customerId}
                    </p>
                  </TableCell>
                  <TableCell>
                    <CustomerAccessStatusBadge status={customer.accessStatus} />
                  </TableCell>
                  <TableCell className="text-sm capitalize text-[var(--fm-text-muted)]">
                    {customer.subscriptionState
                      ? customer.subscriptionState.toLowerCase().replaceAll("_", " ")
                      : "No membership"}
                  </TableCell>
                  <TableCell className="font-medium">{customer.orderCount}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                    {date(customer.lastOrderAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                    {date(customer.createdAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Open actions for ${customerLabel(customer)}`}
                        >
                          <EllipsisVertical aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setSelectedCustomer(customer);
                            setPanelMode("customer");
                            setPanelOpen(true);
                          }}
                        >
                          <Eye aria-hidden="true" />
                          View details
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void copyCustomerId(customer)}>
                          <Clipboard aria-hidden="true" />
                          {copiedId === customer.customerId ? "Copied" : "Copy customer ID"}
                        </DropdownMenuItem>
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
            nextCursor={customers?.nextCursor ?? null}
            onPrevious={pagination.previous}
            onNext={pagination.next}
          />
        ) : null}
      </section>
    </section>
  );

  const inviteDetail = (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-5">
        <div>
          <h2 id="customer-panel-title" className="text-xl font-bold tracking-[-0.03em]">
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
          onClick={() => setPanelOpen(false)}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
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
                          )
                        )
                          await load(appliedQuery, pagination.cursor);
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
        <Button type="button" variant="outline" onClick={() => setPanelOpen(false)}>
          Close
        </Button>
      </div>
    </>
  );

  const customerDetail = selectedCustomer ? (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
            Customer details
          </p>
          <h2
            id="customer-panel-title"
            className="mt-1 truncate text-xl font-bold tracking-[-0.03em]"
          >
            {selectedCustomer.email}
          </h2>
          <p className="mt-1 truncate text-sm text-[var(--fm-text-muted)]">
            {selectedCustomer.phone ?? selectedCustomer.customerId}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close customer details"
          onClick={() => setPanelOpen(false)}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-5">
          <CustomerAccessStatusBadge status={selectedCustomer.accessStatus} />
        </div>
        <dl className="divide-y divide-[var(--fm-border)] rounded-lg border border-[var(--fm-border)]">
          {[
            ["Orders", String(selectedCustomer.orderCount)],
            ["Last order", date(selectedCustomer.lastOrderAt)],
            ["Joined", date(selectedCustomer.createdAt)],
            [
              "Membership",
              selectedCustomer.subscriptionState?.toLowerCase().replaceAll("_", " ") ??
                "No membership",
            ],
            ["Customer ID", selectedCustomer.customerId],
          ].map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 px-3 py-3 text-sm">
              <dt className="text-[var(--fm-text-muted)]">{label}</dt>
              <dd className="max-w-64 break-all text-right font-medium capitalize">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--fm-border)] px-5 py-4">
        <Button type="button" variant="outline" onClick={() => setPanelOpen(false)}>
          Close
        </Button>
        <Button asChild>
          <Link href={`/admin/customers/${selectedCustomer.customerId}`} prefetch={false}>
            <ExternalLink aria-hidden="true" />
            Full customer
          </Link>
        </Button>
      </div>
    </>
  ) : null;

  return (
    <AdminMasterDetailWorkspace
      open={panelOpen}
      master={master}
      detail={panelMode === "invite" ? inviteDetail : customerDetail}
      panelId="customer-detail-panel"
      labelledBy="customer-panel-title"
      resizeLabel="Resize customer workspace"
    />
  );
}
