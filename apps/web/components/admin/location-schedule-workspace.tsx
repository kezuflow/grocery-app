"use client";
import { useState } from "react";
import Link from "next/link";
import {
  appErrorCodes,
  type AdminLocationScheduleView,
  type LocationOperatingSchedule,
  type RpcResult,
} from "@freshmarkets/contracts";
import { z, adminLocationScheduleViewSchema } from "@freshmarkets/validation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { PageHeader } from "./admin-shell";
import { useAdminCommandIntent } from "./admin-command-state";

const responseSchema = z.union([
  z.object({ ok: z.literal(true), requestId: z.string(), value: adminLocationScheduleViewSchema }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.enum(appErrorCodes), message: z.string(), requestId: z.string() }),
  }),
]);
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const localDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : "";
};
const time = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const minutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};
type Payload = {
  locationId: string;
  expectedVersion: number;
  schedule: LocationOperatingSchedule;
  reason: string;
};
export function LocationScheduleWorkspace({
  initial,
  locationId,
}: {
  initial: RpcResult<AdminLocationScheduleView>;
  locationId: string;
}) {
  const [result, setResult] = useState(initial);
  const [schedule, setSchedule] = useState<LocationOperatingSchedule>(
    initial.ok && initial.value.schedule ? initial.value.schedule : { weekly: [], closures: [] },
  );
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const intent = useAdminCommandIntent();
  const locked = pending !== null || intent.pending || loading;
  async function refresh() {
    setLoading(true);
    try {
      const next = responseSchema.parse(
        await (
          await fetch(`/api/admin/location-schedule?locationId=${encodeURIComponent(locationId)}`)
        ).json(),
      );
      setResult(next);
      if (next.ok) {
        setSchedule(next.value.schedule ?? { weekly: [], closures: [] });
        setNotice("");
      }
    } catch {
      setNotice("Schedule could not be loaded. Retry refresh.");
    } finally {
      setLoading(false);
    }
  }
  async function save() {
    if (!result.ok || intent.pending) return;
    const payload = pending ?? {
      locationId,
      expectedVersion: result.value.version,
      schedule,
      reason,
    };
    setPending(payload);
    try {
      const next = await intent.submit(async (key) =>
        responseSchema.parse(
          await (
            await fetch("/api/admin/location-schedule", {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": key },
              body: JSON.stringify(payload),
            })
          ).json(),
        ),
      );
      setPending(null);
      if (next.ok) {
        setResult(next);
        setSchedule(next.value.schedule ?? { weekly: [], closures: [] });
        setNotice("Operating schedule saved. Existing orders keep their accepted promises.");
      } else setNotice(next.error.message);
    } catch {
      setNotice("Response not confirmed. Retry the same schedule request.");
    }
  }
  const updateWeekly = (
    index: number,
    patch: Partial<LocationOperatingSchedule["weekly"][number]>,
  ) =>
    setSchedule({
      ...schedule,
      weekly: schedule.weekly.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    });
  return (
    <div className="space-y-4">
      <Link href="/admin/locations" className="underline">
        Locations
      </Link>
      <PageHeader
        title={result.ok ? `${result.value.locationName} operating hours` : "Operating hours"}
        description="Weekly hours and dated closures for new fulfillment. Existing work requires operational review."
      />
      <p role="status">{notice || (!result.ok ? result.error.message : "")}</p>
      <Button variant="outline" disabled={locked} onClick={() => void refresh()}>
        Refresh schedule
      </Button>
      {pending && (
        <Button disabled={intent.pending} onClick={() => void save()}>
          Retry unconfirmed schedule
        </Button>
      )}
      {result.ok && (
        <>
          <p>
            Weekly times use {result.value.timezone}. Unlisted days are closed. Split overnight
            hours across two days.
          </p>
          {!result.value.schedule && (
            <p>Hours are not configured; new fulfillment remains unavailable.</p>
          )}
          <fieldset disabled={locked || !result.value.canManage} className="space-y-4">
            <legend className="font-semibold">Weekly operating hours</legend>
            {schedule.weekly.map((row, index) => (
              <div key={index} className="flex flex-wrap items-end gap-3 rounded border p-3">
                <label>
                  Day {index + 1}
                  <Select
                    disabled={locked || !result.value.canManage}
                    value={String(row.dayOfWeek)}
                    onValueChange={(value) => updateWeekly(index, { dayOfWeek: Number(value) })}
                  >
                    <SelectTrigger aria-label={`Day ${index + 1}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {days.map((day, i) => (
                        <SelectItem key={day} value={String(i + 1)}>
                          {day}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label>
                  Opens
                  <Input
                    aria-label={`Interval ${index + 1} opens`}
                    type="time"
                    value={time(row.opensMinute)}
                    onChange={(event) =>
                      updateWeekly(index, { opensMinute: minutes(event.target.value) })
                    }
                  />
                </label>
                <label>
                  Closes (24:00 for midnight)
                  <Input
                    aria-label={`Interval ${index + 1} closes`}
                    pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00"
                    value={time(row.closesMinute)}
                    onChange={(event) =>
                      updateWeekly(index, { closesMinute: minutes(event.target.value) })
                    }
                  />
                </label>
                <Button
                  variant="outline"
                  onClick={() =>
                    setSchedule({
                      ...schedule,
                      weekly: schedule.weekly.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove interval {index + 1}
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              disabled={schedule.weekly.length >= 28}
              onClick={() =>
                setSchedule({
                  ...schedule,
                  weekly: [
                    ...schedule.weekly,
                    { dayOfWeek: 1, opensMinute: 540, closesMinute: 1020 },
                  ],
                })
              }
            >
              Add operating interval
            </Button>
          </fieldset>
          <fieldset disabled={locked || !result.value.canManage} className="space-y-4">
            <legend className="font-semibold">Dated closures</legend>
            <p>
              Closure inputs use your device timezone. Review the market local times below before
              saving.
            </p>
            {schedule.closures.map((row, index) => (
              <div key={index} className="space-y-2 rounded border p-3">
                {(["startsAt", "endsAt", "reason"] as const).map((field) => (
                  <label key={field} className="block">
                    {field === "startsAt"
                      ? "Closure starts"
                      : field === "endsAt"
                        ? "Closure ends"
                        : "Closure reason"}
                    <Input
                      aria-label={`Closure ${index + 1} ${field}`}
                      type={field === "reason" ? "text" : "datetime-local"}
                      value={field === "reason" ? row[field] : localDateTime(row[field])}
                      onChange={(event) =>
                        setSchedule({
                          ...schedule,
                          closures: schedule.closures.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  [field]:
                                    field === "reason"
                                      ? event.target.value
                                      : event.target.value
                                        ? new Date(event.target.value).toISOString()
                                        : "",
                                }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                <p>
                  {[row.startsAt, row.endsAt]
                    .filter((value) => Number.isFinite(Date.parse(value)))
                    .map((value) =>
                      new Intl.DateTimeFormat("en-PH", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: result.value.timezone,
                      }).format(new Date(value)),
                    )
                    .join(" – ")}
                </p>
                <Button
                  variant="outline"
                  onClick={() =>
                    setSchedule({
                      ...schedule,
                      closures: schedule.closures.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove closure {index + 1}
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              disabled={schedule.closures.length >= 100}
              onClick={() =>
                setSchedule({
                  ...schedule,
                  closures: [...schedule.closures, { startsAt: "", endsAt: "", reason: "" }],
                })
              }
            >
              Add closure
            </Button>
          </fieldset>
          {result.value.canManage && (
            <>
              <label className="block">
                Reason for schedule change
                <Input
                  aria-label="Reason for schedule change"
                  disabled={locked}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <Button disabled={locked || !reason.trim()} onClick={() => void save()}>
                Save operating schedule
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}
