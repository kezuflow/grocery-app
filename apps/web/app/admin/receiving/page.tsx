"use client";
import { useCallback, useEffect, useState } from "react";
import type { ReceivingSessionPage, RpcResult } from "@freshmarkets/contracts";
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
const location = "location-cebu-central";
export default function ReceivingPage() {
  const [page, setPage] = useState<ReceivingSessionPage | null>(null);
  const [state, setState] = useState("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [requirementId, setRequirementId] = useState("");
  const [startVersion, setStartVersion] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const payload = (await (
        await fetch(`/api/admin/receiving?locationId=${location}&limit=50`)
      ).json()) as RpcResult<ReceivingSessionPage>;
      if (!payload.ok) {
        setNotice(
          payload.error.code === "FORBIDDEN"
            ? "Receiving access is not permitted for this scope."
            : payload.error.message,
        );
        setState("error");
        return;
      }
      setPage(payload.value);
      setState("ready");
    } catch {
      setNotice("Network error loading receiving sessions.");
      setState("error");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function start() {
    const expectedVersion = Number(startVersion);
    if (!requirementId.trim() || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
      setNotice("Requirement ID and current version are required.");
      return;
    }
    const response = await fetch("/api/admin/receiving/start", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        locationId: location,
        requirementId: requirementId.trim(),
        expectedVersion,
      }),
    });
    const payload = (await response.json()) as RpcResult<unknown>;
    setNotice(payload.ok ? "Receiving session started." : payload.error.message);
    if (payload.ok) void load();
  }
  async function complete(sessionId: string, expectedVersion: number) {
    const response = await fetch("/api/admin/receiving/complete", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        locationId: location,
        receivingSessionId: sessionId,
        expectedVersion,
      }),
    });
    const payload = (await response.json()) as RpcResult<unknown>;
    setNotice(payload.ok ? "Receiving session completed." : payload.error.message);
    if (payload.ok) void load();
  }
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Receiving"
        description="Record accepted and rejected base-unit quantities through a scoped receiving session."
      />
      {state === "loading" ? (
        <div role="status" aria-label="Loading receiving">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-3 h-12 w-full" />
        </div>
      ) : null}
      {state === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Receiving could not be loaded</AlertTitle>
          <AlertDescription>
            {notice}
            <Button className="mt-3" size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state === "ready" && page ? (
        <>
          <ListPageSection title="Start session">
            <div className="grid gap-2 p-4 sm:grid-cols-3">
              <Input
                aria-label="Procurement requirement ID"
                placeholder="requirement id"
                value={requirementId}
                onChange={(event) => setRequirementId(event.target.value)}
              />
              <Input
                aria-label="Current procurement version"
                placeholder="current version"
                inputMode="numeric"
                value={startVersion}
                onChange={(event) => setStartVersion(event.target.value)}
              />
              <Button onClick={() => void start()}>Start receiving</Button>
            </div>
          </ListPageSection>
          <ListPageSection title="Receiving sessions">
            {notice ? (
              <p role="status" className="border-b p-3 text-sm">
                {notice}
              </p>
            ) : null}
            {page.items.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]">
                No receiving sessions for this location.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Session</TableHead>
                      <TableHead>Expected</TableHead>
                      <TableHead>Accepted / Rejected</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {page.items.map((item) => (
                      <TableRow key={item.receivingSessionId}>
                        <TableCell className="font-mono text-xs">
                          {item.receivingSessionId}
                        </TableCell>
                        <TableCell>{item.expectedBase}</TableCell>
                        <TableCell>
                          {item.acceptedBase} / {item.rejectedBase}
                        </TableCell>
                        <TableCell>
                          <StatusBadge>{item.status}</StatusBadge>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void complete(item.receivingSessionId, item.version)}
                          >
                            Complete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </ListPageSection>
        </>
      ) : null}
    </div>
  );
}
