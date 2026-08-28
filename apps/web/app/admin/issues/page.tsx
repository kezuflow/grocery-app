"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminOrderIssuePage, OrderIssueAction, RpcResult } from "@freshmarkets/contracts";
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

const nextActions: Record<string, OrderIssueAction[]> = {
  SUBMITTED: ["CLAIM"],
  CLAIMED: ["BEGIN_INVESTIGATION", "RESOLVE", "ESCALATE"],
  INVESTIGATING: ["RESOLVE", "ESCALATE"],
  ESCALATED: ["BEGIN_INVESTIGATION"],
  RESOLVED: ["REOPEN"],
};
export default function IssuesPage() {
  const [page, setPage] = useState<AdminOrderIssuePage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    setState("loading");
    try {
      const payload = (await (
        await fetch("/api/admin/order-issues?limit=50")
      ).json()) as RpcResult<AdminOrderIssuePage>;
      if (!payload.ok) {
        setNotice(payload.error.message);
        setState("error");
        return;
      }
      setPage(payload.value);
      setState("ready");
    } catch {
      setNotice("Network error loading order issues.");
      setState("error");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(issueId: string, action: OrderIssueAction, version: number) {
    if (!reason.trim()) {
      setNotice("A reason is required.");
      return;
    }
    const response = await fetch(`/api/admin/order-issues/${encodeURIComponent(issueId)}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ action, reason: reason.trim(), expectedVersion: version }),
    });
    const payload = (await response.json()) as RpcResult<unknown>;
    setNotice(
      payload.ok ? `Issue ${action.toLowerCase().replaceAll("_", " ")}d.` : payload.error.message,
    );
    if (payload.ok) {
      setReason("");
      await load();
    }
  }
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Order issues"
        description="Customer issue intake and triage. Issue actions never authorize refunds."
        action={
          <Link
            href="/admin/issues/operational-exceptions"
            className="text-sm font-medium underline"
          >
            Operational exceptions feed
          </Link>
        }
      />
      {state === "loading" ? (
        <div role="status">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-3 h-12 w-full" />
        </div>
      ) : null}
      {state === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Issues could not be loaded</AlertTitle>
          <AlertDescription>
            {notice}
            <br />
            <Button className="mt-3" size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state === "ready" && page ? (
        <ListPageSection title="Issue queue">
          {notice ? (
            <p role="status" className="border-b p-3 text-sm">
              {notice}
            </p>
          ) : null}
          <div className="p-4">
            <Input
              aria-label="Issue action reason"
              placeholder="reason for the next action"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {page.items.length === 0 ? (
            <p className="p-5 pt-0 text-sm text-[var(--fm-text-muted)]">No customer issues.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((issue) => (
                  <TableRow key={issue.issueId}>
                    <TableCell className="font-mono text-xs">{issue.orderId}</TableCell>
                    <TableCell>{issue.category}</TableCell>
                    <TableCell>
                      <StatusBadge>{issue.status}</StatusBadge>
                    </TableCell>
                    <TableCell>{issue.assignedStaffId ?? "—"}</TableCell>
                    <TableCell className="flex flex-wrap gap-1">
                      {(nextActions[issue.status] ?? []).map((action) => (
                        <Button
                          key={action}
                          size="sm"
                          variant={action === "RESOLVE" ? "default" : "outline"}
                          onClick={() => void act(issue.issueId, action, issue.version)}
                        >
                          {action.replaceAll("_", " ")}
                        </Button>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ListPageSection>
      ) : null}
    </div>
  );
}
