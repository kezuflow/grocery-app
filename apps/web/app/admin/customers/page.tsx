"use client";

import type {
  AdminCustomerPage,
  AdminCustomerSummary,
  CustomerInvitationPage,
  RpcResult,
} from "@freshmarkets/contracts";
import { Clipboard, EllipsisVertical, Eye, MailPlus, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";
import { useAdminCommandIntent } from "../../../components/admin/admin-command-state";
import { CustomerAccessStatusBadge } from "../../../components/admin/customer-status-badges";
import { AdminLiveRegion, AdminPageState } from "../../../components/admin/admin-page-state";
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
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inviteIntent = useAdminCommandIntent();
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
      const invitationPayload =
        (await invitationResponse.json()) as RpcResult<CustomerInvitationPage>;
      setCustomers(customerPayload.value);
      setInvitations(invitationPayload.ok ? invitationPayload.value : null);
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
    try {
      const payload = await inviteIntent.submit(async (idempotencyKey) => {
        const response = await fetch("/api/admin/customers/invitations", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
          body: JSON.stringify({ email: inviteEmail.trim() }),
        });
        return (await response.json()) as RpcResult<unknown>;
      });
      setNotice(payload.ok ? "Invitation created." : payload.error.message);
      if (payload.ok) {
        setInviteEmail("");
        setInviteOpen(false);
        await load(appliedQuery, pagination.cursor);
      }
    } catch {
      setNotice("Connection lost. Retry to safely reuse the same invitation request.");
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

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Customers"
        action={
          <Button
            type="button"
            size="sm"
            className="fm-admin-reference-primary"
            onClick={() => setInviteOpen((open) => !open)}
          >
            <MailPlus aria-hidden="true" />
            Invite customer
          </Button>
        }
      />
      <AdminLiveRegion message={notice} />

      {inviteOpen ? (
        <section className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-4 shadow-[var(--fm-shadow-card)]">
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={invite}>
            <label className="grid flex-1 gap-1.5 text-sm font-medium sm:max-w-sm">
              Email address
              <Input
                placeholder="customer@example.com"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
              />
            </label>
            <Button
              type="submit"
              size="sm"
              className="fm-admin-reference-primary"
              disabled={inviteIntent.pending}
            >
              {inviteIntent.pending ? "Sending…" : "Send invitation"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
          </form>
          {invitations && invitations.items.length > 0 ? (
            <p className="mt-3 text-xs text-[var(--fm-text-muted)]">
              {invitations.items.length} pending invitation
              {invitations.items.length === 1 ? "" : "s"} on this page
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white shadow-[var(--fm-shadow-card)]">
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
                    <Link
                      className="font-medium hover:underline"
                      href={`/admin/customers/${customer.customerId}`}
                      prefetch={false}
                    >
                      {customer.email}
                    </Link>
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
                        <DropdownMenuItem asChild>
                          <Link href={`/admin/customers/${customer.customerId}`} prefetch={false}>
                            <Eye aria-hidden="true" />
                            View details
                          </Link>
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
    </div>
  );
}
