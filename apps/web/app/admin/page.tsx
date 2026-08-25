"use client";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { PackageCheck, Boxes, Truck, ClipboardList } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
const work = [
  { name: "Committed demand", value: "Aggregated by cycle and pool", icon: ClipboardList },
  { name: "Inventory", value: "Location-specific base units", icon: Boxes },
  { name: "Fulfillment", value: "Pick, exception, pack", icon: PackageCheck },
  { name: "Delivery", value: "Dispatch and rider proof", icon: Truck },
];
export default function AdminPage() {
  const [result, setResult] = useState("");
  async function command(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = await fetch("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as {
      ok: boolean;
      value?: { id: string; status: string };
      error?: { message: string };
    };
    setResult(
      payload.ok
        ? `${payload.value?.id}: ${payload.value?.status}`
        : (payload.error?.message ?? "Command failed."),
    );
  }
  return (
    <main className="min-h-screen bg-slate-100">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-semibold text-emerald-700">FreshMarkets Operations</p>
            <h1 className="text-xl font-semibold">Current Cebu cycle</h1>
          </div>
          <Badge>Location scope required</Badge>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[1fr_360px]">
        <section>
          <h2 className="text-lg font-semibold">Operational workspaces</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {work.map((item) => (
              <article key={item.name} className="flex gap-4 rounded-lg border bg-white p-5">
                <item.icon className="size-5 text-emerald-700" />
                <div>
                  <h3 className="font-medium">{item.name}</h3>
                  <p className="mt-1 text-sm text-slate-600">{item.value}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-6 rounded-lg border bg-white">
            <div className="border-b px-5 py-4">
              <h2 className="font-semibold">Exception queue</h2>
            </div>
            <p className="p-6 text-sm text-slate-600">
              No active exceptions. Supply shortages and failed deliveries appear here with explicit
              resolution commands.
            </p>
          </div>
        </section>
        <aside className="rounded-lg border bg-white p-5">
          <h2 className="font-semibold">Run operational command</h2>
          <form onSubmit={command} className="mt-4 grid gap-3">
            <select name="command" className="rounded border p-2">
              <option value="fulfillment">Fulfillment</option>
              <option value="delivery">Delivery</option>
              <option value="inventory">Inventory adjustment</option>
              <option value="procurement">Procurement requirement</option>
            </select>
            <input name="orderId" placeholder="Order ID" className="rounded border p-2" />
            <select name="action" className="rounded border p-2">
              <option value="START">Start picking</option>
              <option value="PACK">Pack</option>
              <option value="DISPATCH">Dispatch</option>
              <option value="DELIVER">Delivered</option>
              <option value="FAIL">Failed delivery</option>
            </select>
            <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
            <Button type="submit">Submit command</Button>
          </form>
          {result ? (
            <p role="status" className="mt-4 text-sm">
              {result}
            </p>
          ) : null}
          <Link href="/" className="mt-6 block text-sm underline">
            Marketplace
          </Link>
        </aside>
      </div>
    </main>
  );
}
