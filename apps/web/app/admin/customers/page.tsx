"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminCustomerPage, CustomerInvitationPage, RpcResult } from "@freshmarkets/contracts";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { PageHeader, ListPageSection, StatusBadge } from "../../../components/admin/admin-shell";
import { CUSTOMER_SUB_NAVIGATION } from "../../../components/admin/admin-navigation";
import { useAdminCommandIntent } from "../../../components/admin/admin-command-state";
import {
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready" };

export default function CustomersPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [customers, setCustomers] = useState<AdminCustomerPage | null>(null);
  const [invitations, setInvitations] = useState<CustomerInvitationPage | null>(null);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const inviteIntent = useAdminCommandIntent();
  const pagination = useAdminPagination();
  const invitationPagination = useAdminPagination();

  const load = useCallback(
    (search: string, cursor: string | null, invitationCursor: string | null) => {
      setState({ phase: "loading" });
      void (async () => {
        try {
          const params = new URLSearchParams({ limit: "50" });
          if (search.trim() !== "") params.set("query", search.trim());
          if (cursor) params.set("cursor", cursor);
          const [customerResponse, invitationResponse] = await Promise.all([
            fetch(`/api/admin/customers?${params}`),
            fetch(
              `/api/admin/customers/invitations${invitationCursor ? `?cursor=${encodeURIComponent(invitationCursor)}` : ""}`,
            ),
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
          setState({ phase: "ready" });
        } catch {
          setState({
            phase: "error",
            message: "Network error loading customers.",
            requestId: null,
          });
        }
      })();
    },
    [],
  );

  useEffect(
    () => load(appliedQuery, pagination.cursor, invitationPagination.cursor),
    [appliedQuery, invitationPagination.cursor, load, pagination.cursor],
  );

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (inviteEmail.trim() === "") {
      setNotice("An email is required.");
      return;
    }
    let payload: RpcResult<unknown>;
    try {
      payload = await inviteIntent.submit(async (idempotencyKey) => {
        const response = await fetch("/api/admin/customers/invitations", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
          body: JSON.stringify({ email: inviteEmail.trim() }),
        });
        return (await response.json()) as RpcResult<unknown>;
      });
    } catch {
      setNotice("Connection lost. Retry to safely reuse the same invitation request.");
      return;
    }
    setNotice(
      payload.ok ? "Invitation created." : (payload.error?.message ?? "The invitation failed."),
    );
    if (payload.ok) {
      setInviteEmail("");
      load(appliedQuery, pagination.cursor, invitationPagination.cursor);
    }
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Customers"
        description="Commerce access, invitations, and privacy requests. Administration is global-scope only."
      />
      <nav aria-label="Customer sub-navigation" className="flex gap-3 text-sm">
        {CUSTOMER_SUB_NAVIGATION.map((item) => (
          <Link
            key={item.code}
            href={item.href}
            className={
              item.code === "customers"
                ? "font-semibold text-[var(--fm-primary-dark)] underline"
                : "text-[var(--fm-text-muted)] hover:text-[var(--fm-text)]"
            }
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {state.phase === "loading" ? (
        <div className="space-y-3" role="status" aria-label="Loading customers">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}

      {state.phase === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Customers could not be loaded</AlertTitle>
          <AlertDescription>
            {state.message}
            {state.requestId ? (
              <>
                <br />
                <span className="font-mono text-xs">Request reference: {state.requestId}</span>
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {state.phase === "ready" ? (
        <>
          {notice ? (
            <p
              role="status"
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-3 text-sm"
            >
              {notice}
            </p>
          ) : null}

          <ListPageSection
            title="Invite a customer"
            description="Invitations never collect a password."
          >
            <form className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center" onSubmit={invite}>
              <Input
                aria-label="Invitee email"
                placeholder="email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                className="sm:w-72"
              />
              <Button type="submit" size="sm" disabled={inviteIntent.pending}>
                {inviteIntent.pending ? "Sending…" : "Send invitation"}
              </Button>
              {invitations && invitations.items.length > 0 ? (
                <span className="text-xs text-[var(--fm-text-muted)]">
                  {invitations.items.length} pending invitation
                  {invitations.items.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </form>
            <AdminCursorPagination
              pageNumber={invitationPagination.pageNumber}
              nextCursor={invitations?.nextCursor ?? null}
              onPrevious={invitationPagination.previous}
              onNext={invitationPagination.next}
            />
          </ListPageSection>

          <ListPageSection title="Customers">
            <form
              className="flex gap-2 p-4 sm:items-center"
              onSubmit={(event) => {
                event.preventDefault();
                setAppliedQuery(query.trim());
                pagination.reset();
              }}
            >
              <Input
                aria-label="Search by email"
                placeholder="search by email"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="sm:w-72"
              />
              <Button type="submit" size="sm" variant="outline">
                Search
              </Button>
              {query !== "" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
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
            {customers === null || customers.items.length === 0 ? (
              <p className="p-5 pt-0 text-sm text-[var(--fm-text-muted)]" role="status">
                {query !== "" ? "No customers match the search." : "No customers exist yet."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead>Membership</TableHead>
                    <TableHead>Orders</TableHead>
                    <TableHead>
                      <span className="sr-only">Detail link</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.items.map((customer) => (
                    <TableRow key={customer.customerId}>
                      <TableCell className="font-mono text-xs">{customer.email}</TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={customer.accessStatus === "active" ? "success" : "danger"}
                        >
                          {customer.accessStatus}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-xs">{customer.subscriptionState ?? "—"}</TableCell>
                      <TableCell className="text-xs">{customer.orderCount}</TableCell>
                      <TableCell>
                        <Link
                          href={`/admin/customers/${customer.customerId}`}
                          className="text-xs font-medium text-[var(--fm-info)] underline"
                        >
                          Manage
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <AdminCursorPagination
              pageNumber={pagination.pageNumber}
              nextCursor={customers?.nextCursor ?? null}
              onPrevious={pagination.previous}
              onNext={pagination.next}
            />
          </ListPageSection>
        </>
      ) : null}
    </div>
  );
}
