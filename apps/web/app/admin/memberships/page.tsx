"use client";
import { useCallback, useEffect, useState } from "react";
import type { AdminMembershipPage, RpcResult } from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { ListPageSection, PageHeader, StatusBadge } from "../../../components/admin/admin-shell";
import { useAdminCommandIntent } from "../../../components/admin/admin-command-state";
import {
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";
import { WorkspaceNavigation } from "../../../components/admin/workspace-navigation";

export default function MembershipsPage() {
  const [page, setPage] = useState<AdminMembershipPage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const commandIntent = useAdminCommandIntent();
  const pagination = useAdminPagination();
  const load = useCallback(async (cursor: string | null) => {
    setState("loading");
    try {
      const payload = (await (
        await fetch(
          `/api/admin/memberships?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        )
      ).json()) as RpcResult<AdminMembershipPage>;
      if (!payload.ok) {
        setNotice(payload.error.message);
        setState("error");
        return;
      }
      setPage(payload.value);
      setState("ready");
    } catch {
      setNotice("Network error loading memberships.");
      setState("error");
    }
  }, []);
  useEffect(() => {
    void load(pagination.cursor);
  }, [load, pagination.cursor]);
  async function change(
    subscriptionId: string,
    version: number,
    action: "pause" | "resume" | "cancel",
  ) {
    if (!reason.trim()) {
      setNotice("A reason is required.");
      return;
    }
    let payload: RpcResult<unknown>;
    try {
      payload = await commandIntent.submit(async (idempotencyKey) => {
        const response = await fetch(
          `/api/admin/memberships/${encodeURIComponent(subscriptionId)}/${action}`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
            body: JSON.stringify({
              reason: reason.trim(),
              expectedVersion: version,
              ...(action === "cancel" ? { timing: "IMMEDIATE" } : {}),
            }),
          },
        );
        return (await response.json()) as RpcResult<unknown>;
      });
    } catch {
      setNotice(
        "Connection lost. Retry the same lifecycle action to safely reuse its request key.",
      );
      return;
    }
    setNotice(payload.ok ? `Membership ${action}d.` : payload.error.message);
    if (payload.ok) {
      setReason("");
      await load(pagination.cursor);
    }
  }
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Memberships"
        description="Subscription lifecycle administration through canonical Membership commands."
      />
      <WorkspaceNavigation parentCode="customers" label="Customer administration" />
      {state === "loading" ? (
        <div role="status">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-3 h-12 w-full" />
        </div>
      ) : null}
      {state === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Memberships could not be loaded</AlertTitle>
          <AlertDescription>
            {notice}
            <br />
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => void load(pagination.cursor)}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state === "ready" && page ? (
        <ListPageSection title="Subscription queue">
          {notice ? (
            <p role="status" className="border-b p-3 text-sm">
              {notice}
            </p>
          ) : null}
          <div className="p-4">
            <Input
              aria-label="Lifecycle reason"
              placeholder="reason for the next action"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {page.items.length === 0 ? (
            <p className="p-5 pt-0 text-sm text-[var(--fm-text-muted)]">No memberships.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Period end</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((membership) => (
                  <TableRow key={membership.subscriptionId}>
                    <TableCell>{membership.customerEmail}</TableCell>
                    <TableCell>
                      <StatusBadge>{membership.state}</StatusBadge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {membership.currentPeriodEndsAt?.slice(0, 10) ?? "—"}
                    </TableCell>
                    <TableCell>{membership.version}</TableCell>
                    <TableCell className="flex gap-1">
                      {membership.state === "ACTIVE" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={commandIntent.pending}
                          onClick={() =>
                            void change(membership.subscriptionId, membership.version, "pause")
                          }
                        >
                          Pause
                        </Button>
                      ) : null}
                      {membership.state === "PAUSED" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={commandIntent.pending}
                          onClick={() =>
                            void change(membership.subscriptionId, membership.version, "resume")
                          }
                        >
                          Resume
                        </Button>
                      ) : null}
                      {!["CANCELED", "EXPIRED"].includes(membership.state) ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={commandIntent.pending}
                          onClick={() =>
                            void change(membership.subscriptionId, membership.version, "cancel")
                          }
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <AdminCursorPagination
            pageNumber={pagination.pageNumber}
            nextCursor={page.nextCursor}
            onPrevious={pagination.previous}
            onNext={pagination.next}
          />
        </ListPageSection>
      ) : null}
    </div>
  );
}
