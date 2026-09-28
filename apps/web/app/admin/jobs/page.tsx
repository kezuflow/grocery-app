"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminScheduledJobRunsValue, RpcResult } from "@freshmarkets/contracts";
import { AdminPageState } from "@/components/admin/admin-page-state";
import { Badge } from "@/components/admin/shadcn/badge";
import { Button } from "@/components/admin/shadcn/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/admin/shadcn/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/admin/shadcn/table";

export default function AdminJobsPage() {
  const [result, setResult] = useState<RpcResult<AdminScheduledJobRunsValue> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((current) => current + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetch("/api/admin/jobs?limit=200", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as RpcResult<AdminScheduledJobRunsValue>;
        if (!body.ok) return body;
        if (!response.ok) throw new Error("Scheduled jobs are unavailable");
        return body;
      })
      .then((body) => {
        if (!controller.signal.aborted) setResult(body);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Scheduled jobs are unavailable",
            requestId: "",
          },
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey]);

  return (
    <section className="flex flex-col gap-4 p-4 sm:p-6" aria-labelledby="admin-jobs-title">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <CardTitle>
              <h1 id="admin-jobs-title" className="text-2xl font-semibold tracking-tight">
                Scheduled jobs
              </h1>
            </CardTitle>
            <CardDescription>Recent platform job attempts, newest first.</CardDescription>
          </div>
          <Button onClick={refresh} size="sm" variant="outline" disabled={loading}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {loading && !result ? <AdminPageState state="loading" /> : null}
          {!loading && result && !result.ok ? (
            <AdminPageState
              state="error"
              message={result.error.message}
              requestId={result.error.requestId}
              onRetry={refresh}
            />
          ) : null}
          {result?.ok && result.value.runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scheduled job runs are recorded yet.</p>
          ) : null}
          {result?.ok && result.value.runs.length > 0 ? (
            <Table aria-label="Recent scheduled job runs">
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Error code</TableHead>
                  <TableHead>Affected</TableHead>
                  <TableHead>Finished</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.value.runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium">{run.jobName}</TableCell>
                    <TableCell>
                      <Badge variant={run.status === "FAILED" ? "destructive" : "secondary"}>
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{run.errorCode ?? "—"}</TableCell>
                    <TableCell>{run.affectedCount ?? "—"}</TableCell>
                    <TableCell>
                      <time dateTime={new Date(run.finishedAt).toISOString()}>
                        {new Date(run.finishedAt).toLocaleString("en-PH", {
                          timeZone: "Asia/Manila",
                        })}
                      </time>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
