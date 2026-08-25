"use client";
import { FormEvent, useState } from "react";
import {
  PackageCheck,
  Boxes,
  Truck,
  ClipboardList,
  AlertCircle,
  Clock3,
  CreditCard,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import {
  AdminShell,
  FilterBar,
  ListPageSection,
  PageHeader,
  StatusBadge,
} from "../../components/admin/admin-shell";
const work = [
  { name: "Committed demand", value: "Aggregated by cycle and pool", icon: ClipboardList },
  { name: "Inventory", value: "Location-specific base units", icon: Boxes },
  { name: "Fulfillment", value: "Pick, exception, pack", icon: PackageCheck },
  { name: "Delivery", value: "Dispatch and rider proof", icon: Truck },
];
const overviewPriorities: ReadonlyArray<readonly [string, string, LucideIcon]> = [
  [
    "Operational exceptions requiring action",
    "Supply, delivery, and payment recovery",
    AlertCircle,
  ],
  ["Current delivery cycle and today's orders", "Cycle, cutoff, capacity, and order state", Clock3],
  ["Inventory and procurement risks", "Availability, committed demand, and receiving", Boxes],
  ["Fulfillment and delivery state", "Picking, packing, dispatch, and failed delivery", Truck],
  ["Payment exceptions", "Attempts, webhooks, refunds, and reconciliation", CreditCard],
];
export default function AdminPage() {
  const [result, setResult] = useState("");
  async function command(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    // Each submission begins one logical action, so the browser creates its
    // idempotency key once here; retries of the same action must resend it.
    const response = await fetch(
      `/api/admin/delivery?v=${encodeURIComponent(String(body.expectedVersion ?? "1"))}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(body),
      },
    );
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
    <AdminShell>
      <div className="mx-auto max-w-[1280px] space-y-6">
        <PageHeader
          title="Overview"
          description="A focused briefing for the current delivery cycle and operational work that needs attention."
          action={<Badge>Location scope required</Badge>}
        />
        <FilterBar>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-[var(--fm-text-muted)]">Scope</span>
            <select
              className="rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-2 py-2"
              defaultValue="cebu"
            >
              <option value="current">Current delivery context</option>
            </select>
          </label>
          <span className="text-xs text-[var(--fm-text-muted)]">Operational Admin view</span>
        </FilterBar>
        <ListPageSection
          title="Overview priority"
          description="The shell reserves this order for authoritative operational summaries as read models mature."
        >
          <ol id="attention-heading" className="divide-y divide-[var(--fm-border)]">
            {overviewPriorities.map(([title, description, Icon], index) => (
              <li key={title} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[var(--fm-radius-control)] bg-[var(--fm-surface-soft)] text-xs font-bold text-[var(--fm-primary-dark)]">
                  {index + 1}
                </span>
                <Icon
                  className="mt-1 size-4 shrink-0 text-[var(--fm-text-muted)]"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-0.5 text-xs text-[var(--fm-text-muted)]">{description}</p>
                </div>
              </li>
            ))}
          </ol>
        </ListPageSection>
        <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            <ListPageSection
              title="Operational workspaces"
              description="Use domain workspaces to inspect queues and issue legal commands."
            >
              <div className="grid gap-0 sm:grid-cols-2">
                {work.map((item) => (
                  <a
                    key={item.name}
                    href={`/admin#${item.name.toLowerCase().split(" ")[0]}`}
                    className="flex gap-4 border-b border-[var(--fm-border)] p-4 hover:bg-[var(--fm-hover)] sm:[&:nth-child(odd)]:border-r"
                  >
                    <item.icon
                      className="mt-0.5 size-5 text-[var(--fm-primary-dark)]"
                      aria-hidden="true"
                    />
                    <div>
                      <h3 className="font-medium">{item.name}</h3>
                      <p className="mt-1 text-sm text-[var(--fm-text-muted)]">{item.value}</p>
                    </div>
                  </a>
                ))}
              </div>
            </ListPageSection>
            <ListPageSection
              title="Exception queue"
              description="No active exceptions in the current local context."
            >
              <p className="flex items-center gap-2 p-5 text-sm text-[var(--fm-text-muted)]">
                <StatusBadge tone="success">Clear</StatusBadge>Supply shortages and failed
                deliveries appear here with explicit resolution commands.
              </p>
            </ListPageSection>
          </div>
          <aside className="h-fit rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5">
            <h2 className="font-semibold">Run operational command</h2>
            <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
              Commands are validated by Core and require the appropriate scope.
            </p>
            <form onSubmit={command} className="mt-4 grid gap-3">
              <select
                name="command"
                aria-label="Command domain"
                className="rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white p-2"
              >
                <option value="fulfillment">Fulfillment</option>
                <option value="delivery">Delivery</option>
                <option value="inventory">Inventory adjustment</option>
                <option value="procurement">Procurement requirement</option>
              </select>
              <input
                name="orderId"
                placeholder="Order ID"
                className="rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] p-2"
              />
              <select
                name="action"
                aria-label="Operational action"
                className="rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white p-2"
              >
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
              <p role="status" className="mt-4 border-t border-[var(--fm-border)] pt-4 text-sm">
                {result}
              </p>
            ) : null}
          </aside>
        </div>
      </div>
    </AdminShell>
  );
}
