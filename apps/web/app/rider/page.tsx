"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, CheckCircle2, TriangleAlert, PackageOpen } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { RiderJobsValue } from "@freshmarkets/contracts";

type RiderState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; jobs: RiderJobsValue["jobs"] };

function shortId(id: string): string {
  return id.length <= 14 ? id : `${id.slice(0, 12)}…`;
}

/**
 * Rider console for assigned jobs only. One logical update keeps one stable
 * idempotency key until a terminal outcome; the job list refreshes after
 * every terminal result so versions shown are always Core's truth.
 */
export default function RiderPage() {
  const [state, setState] = useState<RiderState>({ phase: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());

  const load = useCallback(() => {
    fetch("/api/rider/jobs")
      .then(
        (r) =>
          r.json() as Promise<{
            ok: boolean;
            value?: RiderJobsValue;
            error?: { code: string; message: string };
          }>,
      )
      .then((payload) => {
        if (payload.ok && payload.value) setState({ phase: "ready", jobs: payload.value.jobs });
        else
          setState({
            phase: "error",
            message:
              payload.error?.code === "UNAUTHENTICATED"
                ? "Sign in with your rider account to see assigned deliveries."
                : (payload.error?.message ?? "Assigned jobs could not be loaded."),
          });
      })
      .catch(() => setState({ phase: "error", message: "Network error loading your jobs." }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(orderId: string, version: number, action: "DISPATCH" | "DELIVER" | "FAIL") {
    const actionId = `${orderId}:${action}`;
    let key = keys.current.get(actionId);
    if (!key) {
      key = `delivery-${crypto.randomUUID()}`;
      keys.current.set(actionId, key);
    }
    const response = await fetch(`/api/rider/jobs?v=${encodeURIComponent(String(version))}`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ orderId, action }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      value?: { status: string };
      error?: { code?: string; message?: string };
    };
    if (result.ok)
      setNotice(`Order ${shortId(orderId)} is now ${result.value?.status ?? "updated"}.`);
    else setNotice(result.error?.message ?? "Update failed.");
    if (result.ok || result.error?.code === "STALE_VERSION") {
      keys.current.delete(actionId);
      load();
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-md bg-white px-5 py-8">
      <p className="text-sm font-semibold text-emerald-700">Rider route</p>
      <h1 className="mt-1 text-2xl font-semibold">Your deliveries</h1>

      {state.phase === "loading" ? (
        <p role="status" className="mt-6 rounded border p-5 text-sm text-slate-600">
          Loading assigned jobs…
        </p>
      ) : null}

      {state.phase === "error" ? (
        <p role="alert" className="mt-6 rounded border border-red-200 bg-red-50 p-5 text-sm">
          {state.message}
        </p>
      ) : null}

      {state.phase === "ready" ? (
        <>
          {notice ? (
            <p role="status" className="mt-4 rounded bg-slate-100 p-3 text-sm">
              {notice}
            </p>
          ) : null}
          {state.jobs.length === 0 ? (
            <div className="mt-6 rounded-lg border p-6 text-center">
              <PackageOpen className="mx-auto size-6 text-slate-400" aria-hidden />
              <p className="mt-3 text-sm text-slate-600">
                No deliveries are assigned to you right now. Dispatch assigns new stops.
              </p>
            </div>
          ) : (
            <ul className="mt-6 space-y-4">
              {state.jobs.map((job) => (
                <li key={job.jobId} className="rounded-lg border p-5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm">{shortId(job.orderId)}</span>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        job.status === "FAILED"
                          ? "bg-red-100 text-red-700"
                          : job.status === "DISPATCHED"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {job.status}
                    </span>
                  </div>
                  <div className="mt-3 flex items-start gap-2 text-sm text-slate-600">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden />
                    <AddressSummary snapshotJson={job.addressSnapshotJson} />
                  </div>
                  <div className="mt-4 grid gap-2">
                    {job.allowedActions.map((action) => (
                      <Button
                        key={action}
                        variant={action === "FAIL" ? "outline" : "default"}
                        onClick={() => act(job.orderId, job.version, action)}
                      >
                        {action === "DISPATCH" ? (
                          "Start delivery"
                        ) : action === "DELIVER" ? (
                          <>
                            <CheckCircle2 className="mr-2 size-4" /> Confirm delivered
                          </>
                        ) : (
                          <>
                            <TriangleAlert className="mr-2 size-4" /> Report failure
                          </>
                        )}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-slate-400">v{job.version}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </main>
  );
}

function AddressSummary({ snapshotJson }: { snapshotJson: string }) {
  let label = "Delivery address on file";
  try {
    const snapshot = JSON.parse(snapshotJson) as {
      label?: string;
      recipient?: string;
      line1?: string;
      city?: string;
    };
    const parts = [snapshot.recipient, snapshot.line1, snapshot.city].filter(Boolean);
    label = parts.length > 0 ? parts.join(", ") : (snapshot.label ?? label);
  } catch {
    // Snapshot is display-only here; malformed history falls back to a
    // neutral summary instead of blocking the rider.
  }
  return <span>{label}</span>;
}
