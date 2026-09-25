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
import { notifyCommandSuccess } from "../../../components/admin/admin-feedback";
import {
  tryChangeAdminWorkspace,
  useAdminRouteGuard,
} from "../../../components/admin/use-admin-route-guard";
import { useAdminScopeGuard } from "../admin-context-provider";
import {
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";
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
type ReadState = { phase: "loading" | "ready" | "error"; key: string };
function receivingQuantity(value: number, unit: string | undefined): string {
  const symbol =
    unit === "GRAM"
      ? "g"
      : unit === "MILLILITER"
        ? "mL"
        : unit === "PIECE"
          ? "pcs"
          : (unit ?? "base units");
  return `${value.toLocaleString("en-PH")} ${symbol}`;
}
export default function ReceivingPage() {
  const { locationId, label } = useAdminLocation();
  const cycleId = useSearchParams().get("cycleId");
  const [page, setPage] = useState<ReceivingSessionPage | null>(null);
  const [state, setState] = useState<ReadState>({ phase: "loading", key: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [unresolved, setUnresolved] = useState<ReceivingIntent | null>(null);
  const [lineValues, setLineValues] = useState<
    Record<string, { accepted: string; rejected: string; reason: string; shortage?: string }>
  >({});
  const commandIntent = useAdminCommandIntent();
  const hasDraft = Object.values(lineValues).some((values) =>
    [values.accepted, values.rejected, values.shortage, values.reason].some((value) =>
      Boolean(value?.trim()),
    ),
  );
  const locked = commandIntent.pending || commandIntent.uncertain || !!unresolved;
  useAdminScopeGuard(hasDraft, locked, () => setLineValues({}));
  useAdminRouteGuard(hasDraft, locked);
  const scopeKey = JSON.stringify([locationId, cycleId]);
  const pagination = useAdminPagination(scopeKey);
  const pageKey = JSON.stringify([locationId, cycleId, pagination.cursor]);
  const visibleState = state.key === pageKey ? state.phase : "loading";
  const visiblePage = visibleState === "ready" ? page : null;
  const latestLoad = useRef(0);
  useEffect(() => {
    setLineValues({});
    setNotice(null);
  }, [pageKey]);
  const load = useCallback(
    async (cursor: string | null) => {
      const generation = ++latestLoad.current;
      const key = JSON.stringify([locationId, cycleId, cursor]);
      setState({ phase: "loading", key });
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
          setState({ phase: "error", key });
          return;
        }
        if (
          payload.value.items.some(
            (item) => item.locationId !== locationId || (cycleId && item.cycleId !== cycleId),
          )
        ) {
          setNotice("Receiving returned a different location or delivery week. Reload this scope.");
          setState({ phase: "error", key });
          return;
        }
        // A refetch may carry a newer receipt version. Require fresh inspected quantities.
        setLineValues({});
        setPage(payload.value);
        setState({ phase: "ready", key });
      } catch {
        if (generation !== latestLoad.current) return;
        setNotice("Network error loading receiving sessions.");
        setState({ phase: "error", key });
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
      if (payload.ok) {
        notifyCommandSuccess(intent.success.replace(/\.$/, ""));
        setLineValues({});
      }
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
  function isCurrentItem(item: ReceivingSessionPage["items"][number]): boolean {
    return (
      !!locationId &&
      item.locationId === locationId &&
      (!cycleId || item.cycleId === cycleId) &&
      visiblePage?.items.some(
        (current) => current.receivingSessionId === item.receivingSessionId,
      ) === true
    );
  }
  async function start(item: ReceivingSessionPage["items"][number]) {
    if (!isCurrentItem(item)) return;
    await runCommand(
      "/api/admin/receiving/start",
      { locationId, requirementId: item.requirementId, expectedVersion: item.version },
      "Receiving session started.",
    );
  }
  async function recordLine(item: ReceivingSessionPage["items"][number]) {
    if (!isCurrentItem(item) || commandIntent.pending) return;
    const sessionId = item.receivingSessionId;
    const replacement = item.allowedActions?.includes("REPLACE") ?? false;
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
        expectedVersion: item.version,
        reason: values.reason.trim() || undefined,
      },
      "Receiving line recorded.",
    );
  }
  async function complete(item: ReceivingSessionPage["items"][number]) {
    if (!isCurrentItem(item) || commandIntent.pending) return;
    await runCommand(
      "/api/admin/receiving/complete",
      {
        locationId,
        receivingSessionId: item.receivingSessionId,
        expectedVersion: item.version,
      },
      "Receiving session completed.",
    );
  }
  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Receiving"
        description={`Inspect supplier goods for ${label}. Accepted receipts remain allocated to paid delivery-week orders; record rejected or missing goods separately.`}
      />
      <ScheduledCountedReceiving
        items={visiblePage?.items ?? []}
        receipts={visiblePage?.countedReceipts ?? []}
        scopeKey={scopeKey}
        locationLabel={label}
        disabled={!visiblePage || commandIntent.pending || unresolved !== null}
        onSaved={() => void load(pagination.cursor)}
      />
      {!locationId ? (
        <AdminPageState
          state="permission-empty"
          title="Select a permitted location"
          message="Choose a location scope in the Admin header to inspect receiving sessions."
        />
      ) : visibleState === "loading" ? (
        <div role="status" aria-label="Loading receiving">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-3 h-12 w-full" />
        </div>
      ) : null}
      {locationId && visibleState === "error" ? (
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
      {visiblePage ? (
        <>
          <ListPageSection
            title="Supplier receipts"
            description="Expected purchase quantity and actual inspected goods for the selected location and delivery week."
          >
            {notice ? (
              <p role="status" className="border-b p-3 text-sm">
                {notice}
              </p>
            ) : null}
            {visiblePage.items.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]">
                No receiving sessions for this location.
              </p>
            ) : (
              <div>
                <Table className="block lg:table" aria-label="Receiving sessions">
                  <TableHeader className="hidden lg:table-header-group">
                    <TableRow>
                      <TableHead>Product / delivery week</TableHead>
                      <TableHead>Expected / inspected</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Receipt actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="block lg:table-row-group">
                    {visiblePage.items.map((item) => (
                      <TableRow
                        key={item.receivingSessionId}
                        className="grid grid-cols-2 gap-3 border-b border-[var(--fm-border)] p-4 lg:table-row lg:p-0 [&>td]:min-w-0 [&>td]:p-0 lg:[&>td]:px-4 lg:[&>td]:py-3"
                      >
                        <TableCell className="col-span-2 lg:table-cell">
                          <p className="font-medium">{item.productName ?? "Historical product"}</p>
                          {item.variantName ? <p className="text-sm">{item.variantName}</p> : null}
                          <p className="text-xs text-[var(--fm-text-muted)]">
                            {item.cycleName ?? "Retained cycle"}
                          </p>
                        </TableCell>
                        <TableCell className="col-span-2 space-y-1 text-sm tabular-nums lg:col-span-1">
                          <span className="mb-1 block text-xs text-[var(--fm-text-muted)] lg:hidden">
                            Expected / inspected
                          </span>
                          <p>Expected: {receivingQuantity(item.expectedBase, item.baseUnit)}</p>
                          <p>Accepted: {receivingQuantity(item.acceptedBase, item.baseUnit)}</p>
                          <p>Rejected: {receivingQuantity(item.rejectedBase, item.baseUnit)}</p>
                          {(item.shortageBase ?? 0) > 0 ? (
                            <p>
                              Missing: {receivingQuantity(item.shortageBase ?? 0, item.baseUnit)}
                            </p>
                          ) : null}
                          {(item.replacementBase ?? 0) > 0 ? (
                            <p>
                              Replacements accepted:{" "}
                              {receivingQuantity(item.replacementBase ?? 0, item.baseUnit)}
                            </p>
                          ) : null}
                          {item.allowedActions?.includes("REPLACE") ? (
                            <p className="text-sm">
                              Still needed:{" "}
                              {receivingQuantity(
                                item.expectedBase - item.acceptedBase,
                                item.baseUnit,
                              )}
                              . Contact your supplier, then record the inspected replacement goods
                              here.
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
                              {receivingQuantity(item.legacyAcceptedBase ?? 0, item.baseUnit)}{" "}
                              accepted before cycle allocation tracking. Review retained stock
                              evidence before allocating these goods.
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm">
                          <StatusBadge>
                            {item.resolvedByCancellation ? "resolved" : item.status}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="col-span-2 space-y-2 empty:hidden lg:table-cell lg:empty:table-cell">
                          {item.stockTracking !== "COUNTED_SIZES" &&
                          item.allowedActions?.includes("START") ? (
                            <Button
                              disabled={commandIntent.pending || unresolved !== null}
                              onClick={() => void start(item)}
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
                              className="grid gap-2 sm:grid-cols-2"
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
                                onClick={() => void recordLine(item)}
                              >
                                {item.allowedActions?.includes("REPLACE")
                                  ? "Receive replacement"
                                  : "Record line"}
                              </Button>
                            </fieldset>
                          ) : null}
                          {!item.resolvedByCancellation ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                commandIntent.pending ||
                                unresolved !== null ||
                                !item.allowedActions?.includes("COMPLETE")
                              }
                              onClick={() => void complete(item)}
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
              nextCursor={visiblePage.nextCursor}
              pending={commandIntent.pending || commandIntent.uncertain || unresolved !== null}
              onPrevious={() => tryChangeAdminWorkspace(pagination.previous)}
              onNext={(nextCursor) => tryChangeAdminWorkspace(() => pagination.next(nextCursor))}
            />
          </ListPageSection>
        </>
      ) : null}
      <ScheduledSurplus
        items={visiblePage?.surplus ?? []}
        scopeKey={scopeKey}
        disabled={!visiblePage || commandIntent.pending || unresolved !== null}
        onSaved={() => void load(pagination.cursor)}
      />
    </div>
  );
}
