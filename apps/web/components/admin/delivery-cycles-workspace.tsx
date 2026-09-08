"use client";
import { useEffect, useState } from "react";
import { useAdminContext } from "../../app/admin/admin-context-provider";
import type {
  AdminCycleDestinations,
  AdminDeliveryCyclePage,
  DeliveryCycleDraft,
  RpcResult,
} from "@freshmarkets/contracts";
import { appErrorCodes } from "@freshmarkets/contracts";
import {
  z,
  adminCycleDestinationsSchema,
  adminDeliveryCyclePageSchema,
  adminDeliveryCycleViewSchema,
  deliveryCycleDraftSchema,
} from "@freshmarkets/validation";
import { PageHeader } from "./admin-shell";
import { WorkspaceNavigation } from "./workspace-navigation";
import { useAdminCommandIntent } from "./admin-command-state";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const failure = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.enum(appErrorCodes), message: z.string(), requestId: z.string() }),
});
const listResult = z.union([
  failure,
  z.object({ ok: z.literal(true), requestId: z.string(), value: adminDeliveryCyclePageSchema }),
]);
const destinationsResult = z.union([
  failure,
  z.object({ ok: z.literal(true), requestId: z.string(), value: adminCycleDestinationsSchema }),
]);
const commandResult = z.union([
  failure,
  z.object({ ok: z.literal(true), requestId: z.string(), value: adminDeliveryCycleViewSchema }),
]);
type Command =
  | ({ action: "SAVE" } & DeliveryCycleDraft)
  | { action: "SCHEDULE" | "CANCEL"; cycleId: string; expectedVersion: number; reason: string };
const times = ["orderOpensAt", "cutoffAt", "procurementAt", "preparationAt", "pickupAt"] as const;
const timeLabels = {
  orderOpensAt: "Orders open",
  cutoffAt: "Order cutoff",
  procurementAt: "Procurement starts",
  preparationAt: "Preparation starts",
  pickupAt: "Planned courier pickup",
};
function blank(marketId: string): DeliveryCycleDraft {
  return {
    marketId,
    name: "",
    orderOpensAt: "",
    cutoffAt: "",
    procurementAt: "",
    preparationAt: "",
    pickupAt: "",
    windows: [{ name: "", startsAt: "", endsAt: "" }],
    participation: [],
    expectedVersion: 0,
    reason: "",
  };
}
function localTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
const toInstant = (value: string) => (value ? new Date(value).toISOString() : "");

export function DeliveryCyclesWorkspace({
  initial,
}: {
  initial: RpcResult<AdminDeliveryCyclePage>;
}) {
  const { state: adminState } = useAdminContext();
  const [scheduleReasons, setScheduleReasons] = useState<Record<string, string>>({});
  const [cancelReasons, setCancelReasons] = useState<Record<string, string>>({});
  const [page, setPage] = useState(initial.ok ? initial.value : null);
  const [draft, setDraft] = useState<DeliveryCycleDraft | null>(null);
  const [destinations, setDestinations] = useState<AdminCycleDestinations>({
    items: [],
    nextCursor: null,
  });
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [notice, setNotice] = useState(initial.ok ? "" : initial.error.message);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Command | null>(null);
  const intent = useAdminCommandIntent();
  const marketId = draft?.marketId;
  useEffect(() => {
    let current = true;
    setDestinations({ items: [], nextCursor: null });
    setDestinationError(null);
    setDestinationsLoading(Boolean(marketId));
    if (marketId) {
      fetch(`/api/admin/delivery-cycles?marketId=${encodeURIComponent(marketId)}`)
        .then((response) => response.json())
        .then((json: unknown) => {
          const result = destinationsResult.parse(json);
          if (!current) return;
          if (result.ok) setDestinations(result.value);
          else setDestinationError(result.error.message);
        })
        .catch(() => {
          if (current) setDestinationError("Destinations could not be loaded. Retry the list.");
        })
        .finally(() => {
          if (current) setDestinationsLoading(false);
        });
    }
    return () => {
      current = false;
    };
  }, [marketId]);
  async function loadDestinations() {
    if (!marketId || loading) return;
    setLoading(true);
    try {
      const result = destinationsResult.parse(
        await (
          await fetch(
            `/api/admin/delivery-cycles?marketId=${encodeURIComponent(marketId)}${destinations.nextCursor ? `&cursor=${encodeURIComponent(destinations.nextCursor)}` : ""}`,
          )
        ).json(),
      );
      if (result.ok) {
        setDestinations({
          items: destinations.nextCursor
            ? [...destinations.items, ...result.value.items]
            : result.value.items,
          nextCursor: result.value.nextCursor,
        });
        setDestinationError(null);
      } else setDestinationError(result.error.message);
    } catch {
      setDestinationError("Destinations could not be loaded. Retry the list.");
    } finally {
      setLoading(false);
    }
  }
  async function load(more = false) {
    setLoading(true);
    try {
      const result = listResult.parse(
        await (
          await fetch(
            `/api/admin/delivery-cycles${more && page?.nextCursor ? `?cursor=${encodeURIComponent(page.nextCursor)}` : ""}`,
          )
        ).json(),
      );
      if (result.ok) {
        setPage({
          ...result.value,
          items:
            more && page
              ? [
                  ...new Map(
                    [...page.items, ...result.value.items].map((item) => [item.cycleId, item]),
                  ).values(),
                ]
              : result.value.items,
        });
        setNotice("");
      } else setNotice(result.error.message);
    } catch {
      setNotice("Cycles could not be loaded. Retry refresh.");
    } finally {
      setLoading(false);
    }
  }
  async function submit(command: Command) {
    if (intent.pending) return;
    const submitted = pending ?? command;
    setPending(submitted);
    try {
      const result = await intent.submit(async (key) =>
        commandResult.parse(
          await (
            await fetch("/api/admin/delivery-cycles", {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": key },
              body: JSON.stringify(submitted),
            })
          ).json(),
        ),
      );
      setPending(null);
      if (result.ok) {
        setPage((old) =>
          old
            ? {
                ...old,
                items: [
                  result.value,
                  ...old.items.filter((item) => item.cycleId !== result.value.cycleId),
                ],
              }
            : old,
        );
        setDraft(null);
        setNotice(
          result.value.status === "DRAFT"
            ? "Draft saved. Review the schedule before publishing."
            : result.value.status === "CANCELED"
              ? "Cycle canceled. Unstarted checkout quotes are no longer usable."
              : "Cycle scheduled. Orders become eligible at the configured opening time.",
        );
      } else setNotice(result.error.message);
    } catch {
      setNotice("Response not confirmed. Retry the same cycle request to recover its result.");
    }
  }
  const disabled = pending !== null || intent.pending || loading;
  const format = (value: string | null, timezone: string) =>
    value
      ? new Intl.DateTimeFormat("en-PH", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: timezone,
        }).format(new Date(value))
      : "Not configured";
  if (adminState.phase === "ready" && adminState.selectedScope?.kind !== "GLOBAL" && !pending)
    return <p>Select Global to administer Scheduled cycles.</p>;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Scheduled cycles"
        description="Plan order opening, procurement, preparation and customer delivery windows."
      />
      <WorkspaceNavigation parentCode="settings" label="Settings administration" />
      {notice && (
        <p role="status" className="rounded-lg border p-3">
          {notice}
        </p>
      )}
      {pending && (
        <Button disabled={intent.pending} onClick={() => void submit(pending)}>
          Retry unconfirmed request
        </Button>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={loading || disabled} onClick={() => void load()}>
          Refresh cycles
        </Button>
        {page?.canManage && (
          <Button
            disabled={disabled}
            onClick={() => setDraft(blank(page.markets[0]?.marketId ?? ""))}
          >
            New cycle
          </Button>
        )}
      </div>
      {draft && (
        <form
          className="space-y-4 rounded-lg border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = deliveryCycleDraftSchema.safeParse(draft);
            if (!parsed.success) {
              setNotice(
                "Complete the schedule, at least one delivery window, destinations and reason.",
              );
              return;
            }
            void submit({ action: "SAVE", ...parsed.data });
          }}
        >
          <fieldset disabled={disabled} className="space-y-4">
            <legend className="text-lg font-semibold">
              {draft.cycleId ? "Edit draft" : "New cycle"}
            </legend>
            <Label htmlFor="cycle-market">Market</Label>
            <Select
              value={draft.marketId}
              disabled={!!draft.cycleId || disabled}
              onValueChange={(value) => setDraft({ ...draft, marketId: value, participation: [] })}
            >
              <SelectTrigger id="cycle-market">
                <SelectValue placeholder="Choose market" />
              </SelectTrigger>
              <SelectContent>
                {page?.markets.map((market) => (
                  <SelectItem key={market.marketId} value={market.marketId}>
                    {market.name} · {market.timezone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label htmlFor="cycle-name">Cycle name</Label>
            <Input
              id="cycle-name"
              required
              maxLength={120}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <p className="text-sm text-muted-foreground">
              Enter times in your device timezone (
              {Intl.DateTimeFormat().resolvedOptions().timeZone}). Saved plans below display the
              market timezone.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {times.map((field) => (
                <div key={field} className="space-y-1">
                  <Label htmlFor={`cycle-${field}`}>{timeLabels[field]}</Label>
                  <Input
                    id={`cycle-${field}`}
                    type="datetime-local"
                    required
                    value={localTime(draft[field])}
                    onChange={(event) =>
                      setDraft({ ...draft, [field]: toInstant(event.target.value) })
                    }
                  />
                </div>
              ))}
            </div>
            <fieldset className="space-y-3">
              <legend className="font-medium">Customer delivery windows</legend>
              {draft.windows.map((window, index) => (
                <div key={index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3">
                  <div>
                    <Label htmlFor={`window-name-${index}`}>Window {index + 1} name</Label>
                    <Input
                      id={`window-name-${index}`}
                      required
                      maxLength={120}
                      value={window.name}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          windows: draft.windows.map((item, i) =>
                            i === index ? { ...item, name: event.target.value } : item,
                          ),
                        })
                      }
                    />
                  </div>
                  {(["startsAt", "endsAt"] as const).map((field) => (
                    <div key={field}>
                      <Label htmlFor={`window-${field}-${index}`}>
                        Window {index + 1} {field === "startsAt" ? "starts" : "ends"}
                      </Label>
                      <Input
                        id={`window-${field}-${index}`}
                        type="datetime-local"
                        required
                        value={localTime(window[field])}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            windows: draft.windows.map((item, i) =>
                              i === index
                                ? { ...item, [field]: toInstant(event.target.value) }
                                : item,
                            ),
                          })
                        }
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={draft.windows.length === 1}
                    onClick={() =>
                      setDraft({ ...draft, windows: draft.windows.filter((_, i) => i !== index) })
                    }
                  >
                    Remove window {index + 1}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={draft.windows.length >= 30}
                onClick={() =>
                  setDraft({
                    ...draft,
                    windows: [...draft.windows, { name: "", startsAt: "", endsAt: "" }],
                  })
                }
              >
                Add delivery window
              </Button>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="font-medium">Participating destinations</legend>
              {destinationError && <p role="alert">{destinationError}</p>}
              {destinations.items.map((item) => (
                <Label
                  key={`${item.zoneId}:${item.locationId}`}
                  className="flex items-center gap-2"
                >
                  <Checkbox
                    checked={draft.participation.some(
                      (selected) =>
                        selected.zoneId === item.zoneId && selected.locationId === item.locationId,
                    )}
                    onCheckedChange={(checked) =>
                      setDraft({
                        ...draft,
                        participation: checked
                          ? [
                              ...draft.participation,
                              { zoneId: item.zoneId, locationId: item.locationId },
                            ]
                          : draft.participation.filter(
                              (selected) =>
                                selected.zoneId !== item.zoneId ||
                                selected.locationId !== item.locationId,
                            ),
                      })
                    }
                  />
                  {item.zoneName} · {item.locationName}
                </Label>
              ))}
              {!destinations.items.length && !destinationError && (
                <p className="text-sm">
                  {destinationsLoading
                    ? "Loading eligible destinations…"
                    : "No eligible destinations loaded. Configure active locations and service areas first."}
                </p>
              )}
              {(destinationError || destinations.nextCursor) && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading}
                  onClick={() => void loadDestinations()}
                >
                  {destinationError ? "Retry destinations" : "More destinations"}
                </Button>
              )}
            </fieldset>
            <Label htmlFor="cycle-reason">Reason</Label>
            <Input
              id="cycle-reason"
              required
              maxLength={500}
              value={draft.reason}
              onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
            />
            <div className="flex gap-2">
              <Button type="submit">Save draft</Button>
              <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                Cancel editing
              </Button>
            </div>
          </fieldset>
        </form>
      )}
      {page?.items.length === 0 && <p>No cycles configured.</p>}
      {page?.items.map((cycle) => (
        <article key={cycle.cycleId} className="space-y-3 rounded-lg border p-4">
          <h2 className="text-lg font-semibold">{cycle.name}</h2>
          <p>
            {cycle.status.replaceAll("_", " ")} · {cycle.marketName} · {cycle.timezone}
          </p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {times.map((field) => (
              <div key={field}>
                <dt className="text-muted-foreground">{timeLabels[field]}</dt>
                <dd>{format(cycle[field], cycle.timezone)}</dd>
              </div>
            ))}
          </dl>
          <ul className="text-sm">
            {cycle.windows.map((window) => (
              <li key={window.windowId}>
                {window.name}: {format(window.startsAt, cycle.timezone)} –{" "}
                {format(window.endsAt, cycle.timezone)}
              </li>
            ))}
          </ul>
          <p className="text-sm">
            {cycle.participation
              .map((item) => `${item.zoneName} · ${item.locationName}`)
              .join("; ") || "No participating destinations"}
          </p>
          {page.canManage && cycle.status === "DRAFT" && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  setDraft({
                    cycleId: cycle.cycleId,
                    marketId: cycle.marketId,
                    name: cycle.name,
                    orderOpensAt: cycle.orderOpensAt,
                    cutoffAt: cycle.cutoffAt,
                    procurementAt: cycle.procurementAt ?? "",
                    preparationAt: cycle.preparationAt ?? "",
                    pickupAt: cycle.pickupAt ?? "",
                    windows: cycle.windows.length
                      ? cycle.windows.map(({ name, startsAt, endsAt }) => ({
                          name,
                          startsAt,
                          endsAt,
                        }))
                      : [{ name: "", startsAt: "", endsAt: "" }],
                    participation: cycle.participation.map(({ zoneId, locationId }) => ({
                      zoneId,
                      locationId,
                    })),
                    expectedVersion: cycle.version,
                    reason: "",
                  })
                }
              >
                Edit {cycle.name}
              </Button>
              <Button
                disabled={
                  disabled ||
                  !cycle.pickupAt ||
                  !cycle.windows.length ||
                  !scheduleReasons[cycle.cycleId]?.trim()
                }
                onClick={() =>
                  void submit({
                    action: "SCHEDULE",
                    cycleId: cycle.cycleId,
                    expectedVersion: cycle.version,
                    reason: scheduleReasons[cycle.cycleId] ?? "",
                  })
                }
              >
                Schedule {cycle.name}
              </Button>
              <div className="w-full space-y-1">
                <Label htmlFor={`schedule-reason-${cycle.cycleId}`}>
                  Scheduling reason for {cycle.name}
                </Label>
                <Input
                  id={`schedule-reason-${cycle.cycleId}`}
                  disabled={disabled}
                  maxLength={500}
                  value={scheduleReasons[cycle.cycleId] ?? ""}
                  onChange={(event) =>
                    setScheduleReasons({ ...scheduleReasons, [cycle.cycleId]: event.target.value })
                  }
                />
              </div>
            </div>
          )}
          {page.canManage &&
            ["DRAFT", "SCHEDULED", "OPEN"].includes(cycle.status) &&
            (cycle.cancellationUnavailableReason ? (
              <p className="text-sm text-muted-foreground">
                Cancellation unavailable: {cycle.cancellationUnavailableReason}
              </p>
            ) : (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer font-medium">Cancel unpaid cycle</summary>
                <p className="my-2 text-sm">
                  Cancels this cycle and closes unstarted checkout quotes. Paid Orders and
                  unresolved payments require coordinated recovery.
                </p>
                <Label htmlFor={`cancel-reason-${cycle.cycleId}`}>
                  Cancellation reason for {cycle.name}
                </Label>
                <Input
                  id={`cancel-reason-${cycle.cycleId}`}
                  disabled={disabled}
                  maxLength={500}
                  value={cancelReasons[cycle.cycleId] ?? ""}
                  onChange={(event) =>
                    setCancelReasons({ ...cancelReasons, [cycle.cycleId]: event.target.value })
                  }
                />
                <Button
                  className="mt-2"
                  variant="destructive"
                  disabled={disabled || !cancelReasons[cycle.cycleId]?.trim()}
                  onClick={() =>
                    void submit({
                      action: "CANCEL",
                      cycleId: cycle.cycleId,
                      expectedVersion: cycle.version,
                      reason: cancelReasons[cycle.cycleId] ?? "",
                    })
                  }
                >
                  Cancel {cycle.name}
                </Button>
              </details>
            ))}
        </article>
      ))}
      {page?.nextCursor && (
        <Button variant="outline" disabled={loading || disabled} onClick={() => void load(true)}>
          More cycles
        </Button>
      )}
    </div>
  );
}
