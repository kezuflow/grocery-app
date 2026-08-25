"use client";
import { useState } from "react";
import { MapPin, CheckCircle2, TriangleAlert } from "lucide-react";
import { Button } from "../../components/ui/button";
export default function RiderPage() {
  const [orderId, setOrderId] = useState("");
  const [status, setStatus] = useState("");
  async function run(action: "DISPATCH" | "DELIVER" | "FAIL") {
    const response = await fetch("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "delivery",
        orderId,
        action,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      value?: { status: string };
      error?: { message: string };
    };
    setStatus(
      result.ok ? (result.value?.status ?? "Updated") : (result.error?.message ?? "Update failed"),
    );
  }
  return (
    <main className="mx-auto min-h-screen max-w-md bg-white px-5 py-8">
      <p className="text-sm font-semibold text-emerald-700">Rider route</p>
      <h1 className="mt-1 text-2xl font-semibold">Next delivery</h1>
      <div className="mt-6 rounded-lg border p-5">
        <MapPin className="size-5 text-emerald-700" />
        <label className="mt-4 block text-sm font-medium">
          Order ID
          <input
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            className="mt-2 w-full rounded border p-3"
          />
        </label>
        <div className="mt-5 grid gap-3">
          <Button onClick={() => run("DISPATCH")}>Start delivery</Button>
          <Button onClick={() => run("DELIVER")}>
            <CheckCircle2 className="mr-2 size-4" />
            Confirm delivered
          </Button>
          <Button variant="outline" onClick={() => run("FAIL")}>
            <TriangleAlert className="mr-2 size-4" />
            Report failure
          </Button>
        </div>
        {status ? (
          <p role="status" className="mt-4 rounded bg-slate-100 p-3 text-sm">
            {status}
          </p>
        ) : null}
      </div>
    </main>
  );
}
