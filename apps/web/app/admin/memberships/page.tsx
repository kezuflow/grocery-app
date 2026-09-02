"use client";

import type {
  AdminMembershipPage,
  AdminMembershipSummary,
  RpcResult,
} from "@freshmarkets/contracts";
import { Clipboard, EllipsisVertical, Eye, XCircle, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AdminConfirmationDialog,
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";
import { useAdminCommandIntent } from "../../../components/admin/admin-command-state";
import { AdminStatusPill } from "../../../components/admin/admin-status-pill";
import { MembershipStatusBadge } from "../../../components/admin/customer-status-badges";
import { AdminLiveRegion, AdminPageState } from "../../../components/admin/admin-page-state";
import { PageHeader } from "../../../components/admin/admin-shell";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
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

type MembershipAction = "cancel";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId?: string }
  | { phase: "ready" };

type PendingAction = {
  membership: AdminMembershipSummary;
  action: MembershipAction;
};

const actionPresentation: Readonly<
  Record<
    MembershipAction,
    {
      label: string;
      title: string;
      consequence: string;
      icon: LucideIcon;
      destructive: boolean;
    }
  >
> = {
  cancel: {
    label: "Cancel membership",
    title: "Cancel this membership immediately?",
    consequence: "Ends the membership immediately. This lifecycle transition cannot be undone.",
    icon: XCircle,
    destructive: true,
  },
};

function allowedActions(state: string): ReadonlyArray<MembershipAction> {
  if (["CANCELED", "EXPIRED"].includes(state)) return [];
  return ["cancel"];
}

function date(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default function MembershipsPage() {
  const [page, setPage] = useState<AdminMembershipPage | null>(null);
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const commandIntent = useAdminCommandIntent();
  const pagination = useAdminPagination(appliedQuery);

  const load = useCallback(async (search: string, cursor: string | null) => {
    setState({ phase: "loading" });
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (search.trim()) params.set("query", search.trim());
      if (cursor) params.set("cursor", cursor);
      const payload = (await (
        await fetch(`/api/admin/memberships?${params}`)
      ).json()) as RpcResult<AdminMembershipPage>;
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
      setState({ phase: "error", message: "Network error loading memberships." });
    }
  }, []);

  useEffect(() => {
    void load(appliedQuery, pagination.cursor);
  }, [appliedQuery, load, pagination.cursor]);

  async function applyAction(reason: string) {
    if (!pendingAction) return;
    const { membership, action } = pendingAction;
    try {
      const payload = await commandIntent.submit(async (idempotencyKey) => {
        const response = await fetch(
          `/api/admin/memberships/${encodeURIComponent(membership.subscriptionId)}/${action}`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
            body: JSON.stringify({
              reason,
              expectedVersion: membership.version,
              ...(action === "cancel" ? { timing: "IMMEDIATE" } : {}),
            }),
          },
        );
        return (await response.json()) as RpcResult<unknown>;
      });
      if (!payload.ok) {
        setNotice(payload.error.message);
        return;
      }
      setNotice(`${actionPresentation[action].label} completed.`);
      setPendingAction(null);
      await load(appliedQuery, pagination.cursor);
    } catch {
      setNotice("Connection lost. Retry the lifecycle action safely.");
    }
  }

  async function copyMembershipId(membershipId: string) {
    await navigator.clipboard.writeText(membershipId);
    setCopiedId(membershipId);
    window.setTimeout(() => {
      setCopiedId((current) => (current === membershipId ? null : current));
    }, 2_000);
  }

  const memberships = page?.items ?? [];
  const selectedPresentation = pendingAction ? actionPresentation[pendingAction.action] : null;

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader title="Memberships" />
      <AdminLiveRegion message={notice} />

      <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white shadow-[var(--fm-shadow-card)]">
        <h2 className="sr-only">Membership list</h2>
        <form
          className="flex min-h-14 flex-wrap items-center gap-2 border-b border-[var(--fm-border)] px-4 py-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedQuery(query.trim());
            pagination.reset();
          }}
        >
          <Input
            aria-label="Search memberships"
            placeholder="Search by email or membership ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 sm:w-80"
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
        {copiedId ? (
          <p className="sr-only" role="status">
            Membership ID copied.
          </p>
        ) : null}
        {state.phase === "loading" ? (
          <div className="p-4">
            <AdminPageState state="loading" title="Loading memberships" />
          </div>
        ) : null}
        {state.phase === "error" ? (
          <div className="p-4">
            <AdminPageState
              state="error"
              title="Memberships could not be loaded"
              message={state.message}
              requestId={state.requestId}
              onRetry={() => void load(appliedQuery, pagination.cursor)}
            />
          </div>
        ) : null}
        {state.phase === "ready" && memberships.length === 0 ? (
          <div className="p-4">
            <AdminPageState
              state={appliedQuery ? "filtered-empty" : "empty"}
              message="No memberships are visible in this view."
            />
          </div>
        ) : null}
        {state.phase === "ready" && memberships.length > 0 ? (
          <Table aria-label="Membership list">
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Period end</TableHead>
                <TableHead>Cancellation</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {memberships.map((membership) => {
                const actions = allowedActions(membership.state);
                return (
                  <TableRow key={membership.subscriptionId}>
                    <TableCell>
                      <Link
                        className="font-medium hover:underline"
                        href={`/admin/memberships/${membership.subscriptionId}`}
                        prefetch={false}
                      >
                        {membership.customerEmail}
                      </Link>
                      <p className="mt-0.5 max-w-52 truncate font-mono text-[11px] text-[var(--fm-text-muted)]">
                        {membership.subscriptionId}
                      </p>
                    </TableCell>
                    <TableCell>
                      <MembershipStatusBadge status={membership.state} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                      {date(membership.currentPeriodEndsAt)}
                    </TableCell>
                    <TableCell>
                      {membership.cancelAtPeriodEnd ? (
                        <AdminStatusPill status="PERIOD_END" tone="warning" label="At period end" />
                      ) : (
                        <span className="text-sm text-[var(--fm-text-muted)]">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Open actions for ${membership.customerEmail}`}
                          >
                            <EllipsisVertical aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/admin/memberships/${membership.subscriptionId}`}
                              prefetch={false}
                            >
                              <Eye aria-hidden="true" />
                              View details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => void copyMembershipId(membership.subscriptionId)}
                          >
                            <Clipboard aria-hidden="true" />
                            {copiedId === membership.subscriptionId
                              ? "Copied"
                              : "Copy membership ID"}
                          </DropdownMenuItem>
                          {actions.length > 0 ? <DropdownMenuSeparator /> : null}
                          {actions.map((action) => {
                            const presentation = actionPresentation[action];
                            const Icon = presentation.icon;
                            return (
                              <DropdownMenuItem
                                key={action}
                                onSelect={() => setPendingAction({ membership, action })}
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
                );
              })}
            </TableBody>
          </Table>
        ) : null}

        {state.phase === "ready" ? (
          <AdminCursorPagination
            pageNumber={pagination.pageNumber}
            nextCursor={page?.nextCursor ?? null}
            onPrevious={pagination.previous}
            onNext={pagination.next}
          />
        ) : null}
      </section>

      {pendingAction && selectedPresentation ? (
        <AdminConfirmationDialog
          open
          title={selectedPresentation.title}
          resource={pendingAction.membership.customerEmail}
          scope="Customer membership"
          consequence={selectedPresentation.consequence}
          confirmLabel={selectedPresentation.label}
          cancelLabel="Cancel"
          destructive={selectedPresentation.destructive}
          pending={commandIntent.pending}
          onCancel={() => setPendingAction(null)}
          onConfirm={(reason) => void applyAction(reason)}
        />
      ) : null}
    </div>
  );
}
