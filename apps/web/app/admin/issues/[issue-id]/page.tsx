"use client";
import { useEffect, useState } from "react";
import type { AdminOrderIssueDetail, RpcResult } from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { Button } from "../../../../components/ui/button";
import { Skeleton } from "../../../../components/ui/skeleton";
import { PageHeader, StatusBadge } from "../../../../components/admin/admin-shell";

export default function IssueDetailPage({ params }: { params: Promise<{ "issue-id": string }> }) {
  const [issue, setIssue] = useState<AdminOrderIssueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { "issue-id": issueId } = await params;
      const result = (await (
        await fetch(`/api/admin/order-issues/${encodeURIComponent(issueId)}`)
      ).json()) as RpcResult<AdminOrderIssueDetail>;
      if (!result.ok) setError(result.error.message);
      else setIssue(result.value);
    } catch {
      setError("Network error loading the issue.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="mx-auto max-w-[1000px] space-y-6">
      <PageHeader
        title="Issue detail"
        description="Review the issue state and assigned resolution."
      />
      {loading ? <Skeleton className="h-40 w-full" /> : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Issue could not be loaded</AlertTitle>
          <AlertDescription>
            {error}
            <br />
            <Button className="mt-3" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {issue ? (
        <section className="space-y-3 rounded-lg border p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{issue.category}</h2>
            <StatusBadge>{issue.status}</StatusBadge>
          </div>
          <p className="text-sm">
            Order: <span className="font-mono">{issue.orderId}</span>
          </p>
          <p className="text-sm text-[var(--fm-text-muted)]">
            {issue.details ?? "No details provided."}
          </p>
          <p className="text-sm">Resolution: {issue.resolution ?? "Pending"}</p>
        </section>
      ) : null}
    </div>
  );
}
