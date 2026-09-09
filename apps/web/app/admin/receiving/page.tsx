"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  appErrorCodes,
  receivingRecordStates,
  type ReceivingSessionPage,
} from "@freshmarkets/contracts";
import {
  z,
  scheduledCountedReceiptViewSchema,
  scheduledSurplusViewSchema,
} from "@freshmarkets/validation";
import { ScheduledCountedReceiving } from "../../../components/admin/scheduled-counted-receiving";
import { ScheduledSurplus } from "../../../components/admin/scheduled-surplus";
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
const errorResult = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.enum(appErrorCodes), message: z.string(), requestId: z.string() }),
});
const sessionSchema = z.object({
  receivingSessionId: z.string(),
  requirementId: z.string(),
  cycleId: z.string(),
  locationId: z.string(),
  expectedBase: z.number().int().safe().nonnegative(),
  acceptedBase: z.number().int().safe().nonnegative(),
  rejectedBase: z.number().int().safe().nonnegative(),
  shortageBase: z.number().int().safe().nonnegative().optional(),
  replacementBase: z.number().int().safe().nonnegative().optional(),
  legacyAcceptedBase: z.number().int().safe().nonnegative().optional(),
  resolvedByCancellation: z.boolean().optional(),
  status: z.enum(receivingRecordStates),
  version: z.number().int().safe().positive(),
  productName: z.string().optional(),
  productId: z.string().optional(),
  variantName: z.string().optional(),
  stockTracking: z.enum(["SHARED", "COUNTED_SIZES"]).optional(),
  cycleName: z.string().optional(),
  baseUnit: z.string().optional(),
  allowedActions: z.array(z.enum(["START", "RECORD", "REPLACE", "COMPLETE"])).optional(),
});
const pageResult = z.union([
  errorResult,
  z.object({
    ok: z.literal(true),
    requestId: z.string(),
    value: z.object({
      items: z.array(sessionSchema),
      nextCursor: z.string().nullable(),
      countedReceipts: z.array(scheduledCountedReceiptViewSchema).optional(),
      surplus: z.array(scheduledSurplusViewSchema).optional(),
    }),
  }),
]);
const commandResult = z.union([
  errorResult,
  z.object({ ok: z.literal(true), requestId: z.string(), value: sessionSchema }),
]);
type ReceivingIntent = { path: string; body: string; success: string };
export default function ReceivingPage() {
  const { locationId, label } = useAdminLocation();
  const cycleId = useSearchParams().get("cycleId");
  const [page, setPage] = useState<ReceivingSessionPage | null>(null);
  const [state, setState] = useState("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [unresolved, setUnresolved] = useState<ReceivingIntent | null>(null);
  const [lineValues, setLineValues] = useState<
    Record<string, { accepted: string; rejected: string; reason: string; shortage?: string }>
  >({});
  const commandIntent = useAdminCommandIntent();
  const pagination = useAdminPagination();
  const latestLoad = useRef(0);
  const load = useCallback(
    async (cursor: string | null) => {
      const generation = ++latestLoad.current;
      setState("loading");
      try {
        const payload = pageResult.parse(
          await (
            await fetch(
              `/api/admin/receiving?locationId=${locationId ?? ""}&limit=50${cycleId ? `&cycleId=${encodeURIComponent(cycleId)}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
            )
          ).json(),
        );
        if (generation !== latestLoad.current) return;
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
        if (generation !== latestLoad.current) return;
        setNotice("Network error loading receiving sessions.");
        setState("error");
      }
    },
    [locationId, cycleId],
  );
  useEffect(() => {
    if (locationId) void load(pagination.cursor);
    return () => {
      latestLoad.current += 1;
    };
  }, [load, locationId, pagination.cursor]);

  async function submit(intent: ReceivingIntent) {
    setUnresolved(intent);
    try {
      const payload = await commandIntent.submit(async (idempotencyKey) => {
        const response = await fetch(intent.path, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
          body: intent.body,
        });
        return commandResult.parse(await response.json());
      });
      setUnresolved(null);
      setNotice(payload.ok ? intent.success : payload.error.message);
      if (payload.ok) setLineValues({});
      void load(pagination.cursor);
    } catch {
      setNotice(
        "The receiving result is unknown. Retry the saved request before recording more goods.",
      );
    }
  }
  async function runCommand(path: string, body: object, success: string) {
    if (unresolved || commandIntent.pending) return;
    await submit({ path, body: JSON.stringify(body), success });
  }
  async function start(requirementId: string, expectedVersion: number) {
    if (!locationId) return;
    await runCommand(
      "/api/admin/receiving/start",
      { locationId, requirementId, expectedVersion },
      "Receiving session started.",
    );
  }
  async function recordLine(sessionId: string, expectedVersion: number, replacement = false) {
    if (!locationId || commandIntent.pending) return;
    const values = lineValues[sessionId] ?? { accepted: "", rejected: "", reason: "" };
    const acceptedBase = Number(values.accepted);
    const rejectedBase = replacement ? 0 : Number(values.rejected);
    const shortageBase = replacement ? 0 : Number(values.shortage ?? "");
    if (
      !Number.isSafeInteger(acceptedBase) ||
      acceptedBase < 0 ||
      !Number.isSafeInteger(rejectedBase) ||
      rejectedBase < 0 ||
      !Number.isSafeInteger(shortageBase) ||
      shortageBase < 0 ||
      !Number.isSafeInteger(acceptedBase + rejectedBase + shortageBase) ||
      acceptedBase + rejectedBase + shortageBase === 0
    ) {
      setNotice(
        "Enter positive received quantities in the displayed base unit. Rejected goods are never sellable.",
      );
      return;
    }
    await runCommand(
      "/api/admin/receiving/record-line",
      {
        locationId,
        receivingSessionId: sessionId,
        acceptedBase,
        rejectedBase,
        ...(shortageBase > 0 ? { shortageBase } : {}),
        ...(replacement ? { receiptKind: "REPLACEMENT" } : {}),
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
      <ScheduledCountedReceiving
        items={state === "ready" ? (page?.items ?? []) : []}
        receipts={state === "ready" ? (page?.countedReceipts ?? []) : []}
        locationLabel={label}
        disabled={state !== "ready" || commandIntent.pending || unresolved !== null}
        onSaved={() => void load(pagination.cursor)}
      />
      <ScheduledSurplus
        items={state === "ready" ? (page?.surplus ?? []) : []}
        disabled={state !== "ready" || commandIntent.pending || unresolved !== null}
        onSaved={() => void load(pagination.cursor)}
      />
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
      {unresolved ? (
        <Alert>
          <AlertTitle>Receipt needs recovery</AlertTitle>
          <AlertDescription>
            The saved quantities and request key are retained.
            <Button disabled={commandIntent.pending} onClick={() => void submit(unresolved)}>
              Retry saved receipt
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state === "ready" && page ? (
        <>
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
                <Table className="block sm:table" aria-label="Receiving sessions">
                  <TableHeader className="hidden sm:table-header-group">
                    <TableRow>
                      <TableHead>Product / cycle</TableHead>
                      <TableHead>Expected</TableHead>
                      <TableHead>Accepted / Rejected</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Record goods</TableHead>
                      <TableHead>Resolve</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="block sm:table-row-group">
                    {page.items.map((item) => (
                      <TableRow
                        key={item.receivingSessionId}
                        className="grid grid-cols-2 gap-3 p-4 sm:table-row sm:p-0 [&>td]:min-w-0 [&>td]:p-0 sm:[&>td]:px-4 sm:[&>td]:py-3"
                      >
                        <TableCell className="col-span-2 sm:table-cell">
                          <p className="font-medium">{item.productName ?? "Historical product"}</p>
                          {item.variantName ? <p className="text-sm">{item.variantName}</p> : null}
                          <p className="text-xs text-[var(--fm-text-muted)]">
                            {item.cycleName ?? "Retained cycle"}
                          </p>
                        </TableCell>
                        <TableCell>
                          <span className="mb-1 block text-xs text-[var(--fm-text-muted)] sm:hidden">
                            Expected
                          </span>
                          {item.expectedBase} {item.baseUnit ?? "base units"}
                        </TableCell>
                        <TableCell>
                          <span className="mb-1 block text-xs text-[var(--fm-text-muted)] sm:hidden">
                            Accepted / rejected
                          </span>
                          {item.acceptedBase} / {item.rejectedBase}
                          {(item.shortageBase ?? 0) > 0 ? (
                            <p>Missing: {item.shortageBase}</p>
                          ) : null}
                          {(item.replacementBase ?? 0) > 0 ? (
                            <p>Replacements accepted: {item.replacementBase}</p>
                          ) : null}
                          {item.allowedActions?.includes("REPLACE") ? (
                            <p className="text-sm">
                              Still needed: {item.expectedBase - item.acceptedBase}. Contact your
                              supplier, then record the inspected replacement goods here.
                              <Link
                                className="mt-2 block underline"
                                href={`/admin/procurement?cycleId=${encodeURIComponent(item.cycleId)}&locationId=${encodeURIComponent(item.locationId)}&requirementId=${encodeURIComponent(item.requirementId)}`}
                              >
                                Review affected orders
                              </Link>
                            </p>
                          ) : null}
                          {item.resolvedByCancellation ? (
                            <p className="mt-2 text-sm">
                              Resolved by order cancellation. Refunds may still be processing.
                            </p>
                          ) : null}
                          {(item.legacyAcceptedBase ?? 0) > 0 ? (
                            <p className="mt-1 text-xs text-[var(--fm-text-muted)]">
                              {item.legacyAcceptedBase} accepted before cycle allocation tracking.
                              Review retained stock evidence before allocating these goods.
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <StatusBadge>
                            {item.resolvedByCancellation ? "resolved" : item.status}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="col-span-2 empty:hidden sm:table-cell sm:empty:table-cell">
                          {item.stockTracking !== "COUNTED_SIZES" &&
                          item.allowedActions?.includes("START") ? (
                            <Button
                              disabled={commandIntent.pending || unresolved !== null}
                              onClick={() => void start(item.requirementId, item.version)}
                            >
                              Start receiving
                            </Button>
                          ) : null}
                          {item.stockTracking !== "COUNTED_SIZES" &&
                          item.allowedActions?.some(
                            (action) => action === "RECORD" || action === "REPLACE",
                          ) ? (
                            <fieldset
                              disabled={commandIntent.pending || unresolved !== null}
                              className="grid gap-1 sm:grid-cols-3"
                            >
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
                              {item.allowedActions?.includes("RECORD") ? (
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
                              ) : null}
                              {item.allowedActions?.includes("RECORD") ? (
                                <Input
                                  aria-label={`Missing quantity ${item.receivingSessionId}`}
                                  inputMode="numeric"
                                  placeholder="missing"
                                  value={lineValues[item.receivingSessionId]?.shortage ?? ""}
                                  onChange={(event) =>
                                    setLineValues((current) => ({
                                      ...current,
                                      [item.receivingSessionId]: {
                                        ...(current[item.receivingSessionId] ?? {
                                          accepted: "",
                                          rejected: "",
                                          reason: "",
                                        }),
                                        shortage: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              ) : null}
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
                                onClick={() =>
                                  void recordLine(
                                    item.receivingSessionId,
                                    item.version,
                                    item.allowedActions?.includes("REPLACE"),
                                  )
                                }
                              >
                                {item.allowedActions?.includes("REPLACE")
                                  ? "Receive replacement"
                                  : "Record line"}
                              </Button>
                            </fieldset>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {!item.resolvedByCancellation ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                commandIntent.pending ||
                                unresolved !== null ||
                                !item.allowedActions?.includes("COMPLETE")
                              }
                              onClick={() => void complete(item.receivingSessionId, item.version)}
                            >
                              Complete
                            </Button>
                          ) : null}
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
