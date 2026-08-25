"use client";

import { FormEvent, useState } from "react";
import type { ServiceabilityResult } from "@freshmarkets/contracts";

export default function ServiceabilityPage() {
  const [result, setResult] = useState<ServiceabilityResult | null>(null);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = await fetch("/api/serviceability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ latitude: Number(data.latitude), longitude: Number(data.longitude) }),
    });
    const payload = (await response.json()) as { ok: boolean; value?: ServiceabilityResult };
    if (!response.ok || !payload.ok || !payload.value) {
      setError("Serviceability could not be evaluated.");
      return;
    }
    setResult(payload.value);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">
          Cebu delivery coverage
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Check serviceability</h1>
        <p className="mt-2 text-sm text-slate-600">
          Enter coordinates from a confirmed map location. Core evaluates the active service area,
          delivery zone, and eligible operations locations.
        </p>
      </div>
      <form
        onSubmit={submit}
        className="flex max-w-md flex-col gap-4 rounded-lg border bg-white p-6 shadow-sm"
      >
        <label className="flex flex-col gap-1 text-sm">
          Latitude
          <input
            name="latitude"
            type="number"
            step="any"
            min="-90"
            max="90"
            required
            className="rounded border p-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Longitude
          <input
            name="longitude"
            type="number"
            step="any"
            min="-180"
            max="180"
            required
            className="rounded border p-2"
          />
        </label>
        <button className="rounded bg-slate-950 px-4 py-2 text-sm font-medium text-white">
          Check coverage
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {result ? (
        <section aria-live="polite" className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="font-semibold">
            {result.serviceable ? "Delivery is available" : "Delivery is unavailable"}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {result.serviceable
              ? `${result.serviceArea?.name} · ${result.deliveryZone?.name}`
              : `Reason: ${result.reason}`}
          </p>
          {result.fulfillmentEligibility.eligible ? (
            <p className="mt-2 text-sm text-slate-600">
              Operations coverage confirmed. Fulfillment is assigned by Core.
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
