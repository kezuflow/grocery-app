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
import { useAdminLocation } from "../../../components/admin/use-admin-location";
import { useAdminCommandIntent } from "../../../components/admin/admin-command-state";
import {
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";
import { WorkspaceNavigation } from "../../../components/admin/workspace-navigation";
import { AdminPageState } from "../../../components/admin/admin-page-state";
export default function ReceivingPage() {
  const { locationId, label } = useAdminLocation();
  const [page, setPage] = useState<ReceivingSessionPage | null>(null);
  const [state, setState] = useState("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [requirementId, setRequirementId] = useState("");
  const [startVersion, setStartVersion] = useState("");
  const [lineValues, setLineValues] = useState<
    Record<string, { accepted: string; rejected: string; reason: string }>
  >({});
  const commandIntent = useAdminCommandIntent();
  const pagination = useAdminPagination();
  const load = useCallback(
    async (cursor: string | null) => {
      setState("loading");
      try {
        const payload = (await (
          await fetch(
            `/api/admin/receiving?locationId=${locationId ?? ""}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          )
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
    },
    [locationId],
  );
  useEffect(() => {
    if (locationId) void load(pagination.cursor);
  }, [load, locationId, pagination.cursor]);

  async function runCommand(path: string, body: object, success: string) {
    try {
      const payload = await commandIntent.submit(async (idempotencyKey) => {
        const response = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
          body: JSON.stringify(body),
        });
        return (await response.json()) as RpcResult<unknown>;
      });
      setNotice(payload.ok ? success : payload.error.message);
      if (payload.ok || payload.error.code === "STALE_VERSION" || payload.error.code === "CONFLICT")
        void load(pagination.cursor);
    } catch {
      setNotice(
        "Connection lost. Retry the same receiving action to safely reuse its request key.",
      );
    }
  }
  async function start() {
    const expectedVersion = Number(startVersion);
    if (!requirementId.trim() || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
      setNotice("Requirement ID and current version are required.");
      return;
    }
    if (!locationId || commandIntent.pending) return;
    await runCommand(
      "/api/admin/receiving/start",
      {
        locationId,
        requirementId: requirementId.trim(),
        expectedVersion,
      },
      "Receiving session started.",
    );
  }
  async function recordLine(sessionId: string, expectedVersion: number) {
    if (!locationId || commandIntent.pending) return;
    const values = lineValues[sessionId] ?? { accepted: "", rejected: "", reason: "" };
    const acceptedBase = Number(values.accepted);
    const rejectedBase = Number(values.rejected);
    if (
      !Number.isInteger(acceptedBase) ||
      acceptedBase < 0 ||
      !Number.isInteger(rejectedBase) ||
      rejectedBase < 0
    ) {
      setNotice("Accepted and rejected quantities must be non-negative integers.");
      return;
    }
    await runCommand(
      "/api/admin/receiving/record-line",
      {
        locationId,
        receivingSessionId: sessionId,
        acceptedBase,
        rejectedBase,
        expectedVersion,
        reason: values.reason.trim() || undefined,
      },
      "Receiving line recorded.",
    );
  }
  async function complete(sessionId: string, expectedVersion: number) {
    if (!locationId || commandIntent.pending) return;
    await runCommand(
      "/api/admin/receiving/complete",
      {
        locationId,
        receivingSessionId: sessionId,
        expectedVersion,
      },
      "Receiving session completed.",
    );
  }
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Receiving"
        description={`Record accepted and rejected base-unit quantities for ${label}.`}
      />
      <WorkspaceNavigation parentCode="procurement" label="Procurement administration" />
      {!locationId ? (
        <AdminPageState
          state="permission-empty"
          title="Select a permitted location"
          message="Choose a location scope in the Admin header to inspect receiving sessions."
        />
      ) : state === "loading" ? (
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
              <Button disabled={commandIntent.pending || !locationId} onClick={() => void start()}>
                {commandIntent.pending ? "Working…" : "Start receiving"}
              </Button>
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
                          <div className="grid gap-1 sm:grid-cols-3">
                            <Input
                              aria-label={`Accepted quantity ${item.receivingSessionId}`}
                              inputMode="numeric"
                              placeholder="accepted"
                              value={lineValues[item.receivingSessionId]?.accepted ?? ""}
                              onChange={(event) =>
                                setLineValues((current) => ({
                                  ...current,
                                  [item.receivingSessionId]: {
                                    ...(current[item.receivingSessionId] ?? {
                                      accepted: "",
                                      rejected: "",
                                      reason: "",
                                    }),
                                    accepted: event.target.value,
                                  },
                                }))
                              }
                            />
                            <Input
                              aria-label={`Rejected quantity ${item.receivingSessionId}`}
                              inputMode="numeric"
                              placeholder="rejected"
                              value={lineValues[item.receivingSessionId]?.rejected ?? ""}
                              onChange={(event) =>
                                setLineValues((current) => ({
                                  ...current,
                                  [item.receivingSessionId]: {
                                    ...(current[item.receivingSessionId] ?? {
                                      accepted: "",
                                      rejected: "",
                                      reason: "",
                                    }),
                                    rejected: event.target.value,
                                  },
                                }))
                              }
                            />
                            <Input
                              aria-label={`Receiving reason ${item.receivingSessionId}`}
                              placeholder="reason"
                              value={lineValues[item.receivingSessionId]?.reason ?? ""}
                              onChange={(event) =>
                                setLineValues((current) => ({
                                  ...current,
                                  [item.receivingSessionId]: {
                                    ...(current[item.receivingSessionId] ?? {
                                      accepted: "",
                                      rejected: "",
                                      reason: "",
                                    }),
                                    reason: event.target.value,
                                  },
                                }))
                              }
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={commandIntent.pending}
                              onClick={() => void recordLine(item.receivingSessionId, item.version)}
                            >
                              Record line
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={commandIntent.pending}
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
            <AdminCursorPagination
              pageNumber={pagination.pageNumber}
              nextCursor={page.nextCursor}
              onPrevious={pagination.previous}
              onNext={pagination.next}
            />
          </ListPageSection>
        </>
      ) : null}
    </div>
  );
}
