"use client";

import type { Capability, CapabilityDefinitionView } from "@freshmarkets/contracts";
import { Field, FieldGroup, FieldLegend, FieldSet } from "@/components/admin/shadcn/field";

const groups = [
  {
    id: "administration",
    title: "Administrator and setup",
    description: "Staff access, locations, settings, and audit history.",
  },
  {
    id: "commerce",
    title: "Catalog and customers",
    description: "Products, prices, promotions, and customer records.",
  },
  {
    id: "orders",
    title: "Orders and finance",
    description: "Orders, payments, and refunds.",
  },
  {
    id: "operations",
    title: "Fulfillment and stock staff",
    description: "Inventory, receiving, transfers, packing, and delivery.",
  },
  {
    id: "reporting",
    title: "Reporting",
    description: "Approved analytics and reports.",
  },
  {
    id: "retained",
    title: "Retained membership access",
    description: "Historical permission codes without a current membership workflow.",
  },
] as const;

type GroupId = (typeof groups)[number]["id"];

// Keep every canonical capability visible exactly once when the vocabulary changes.
const groupByCapability: Record<Capability, GroupId> = {
  "staff.read": "administration",
  "staff.manage": "administration",
  "locations.read": "administration",
  "locations.manage": "administration",
  "settings.read": "administration",
  "settings.manage": "administration",
  "audit.read": "administration",
  "catalog.read": "commerce",
  "catalog.manage": "commerce",
  "prices.read": "commerce",
  "prices.manage": "commerce",
  "promotions.read": "commerce",
  "promotions.manage": "commerce",
  "customers.read": "commerce",
  "customers.manage": "commerce",
  "orders.read": "orders",
  "orders.manage": "orders",
  "payments.read": "orders",
  "payments.manage": "orders",
  "refunds.manage": "orders",
  "inventory.read": "operations",
  "inventory.adjust": "operations",
  "transfers.read": "operations",
  "transfers.manage": "operations",
  "procurement.read": "operations",
  "procurement.manage": "operations",
  "fulfillment.read": "operations",
  "fulfillment.manage": "operations",
  "delivery.read": "operations",
  "delivery.manage": "operations",
  "analytics.read": "reporting",
  "memberships.read": "retained",
  "memberships.manage": "retained",
};

export function RoleCapabilityGroups({
  capabilities,
  assigned,
  editable,
  onToggle,
}: {
  capabilities: ReadonlyArray<CapabilityDefinitionView>;
  assigned: ReadonlySet<Capability>;
  editable: boolean;
  onToggle: (capability: Capability, grant: boolean, trigger: HTMLElement) => void;
}) {
  return (
    <FieldGroup className="gap-4 p-4">
      <p className="text-sm text-muted-foreground">
        Staff scope assignments determine where these capabilities can be used.
      </p>
      {groups.map((group) => {
        const items = capabilities.filter(
          (capability) => groupByCapability[capability.code] === group.id,
        );
        if (items.length === 0) return null;
        const assignedCount = items.filter((capability) => assigned.has(capability.code)).length;
        return (
          <FieldSet key={group.id} className="gap-3 rounded-lg border border-border p-4">
            <FieldLegend variant="label" className="mb-0">
              {group.title}
            </FieldLegend>
            <p className="text-sm text-muted-foreground">
              {group.description} {assignedCount} of {items.length} assigned.
            </p>
            <FieldGroup className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((capability) => (
                <Field
                  key={capability.code}
                  orientation="horizontal"
                  className="items-start rounded-md border border-border p-3"
                >
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-primary"
                      disabled={!editable}
                      checked={assigned.has(capability.code)}
                      onChange={(event) =>
                        onToggle(capability.code, event.target.checked, event.currentTarget)
                      }
                    />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span>{capability.description}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {capability.code}
                      </span>
                    </span>
                  </label>
                </Field>
              ))}
            </FieldGroup>
          </FieldSet>
        );
      })}
    </FieldGroup>
  );
}
