"use client";
import { useState } from "react";
import type { ScheduledSurplusView } from "@freshmarkets/contracts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../ui/sheet";
import { useAdminCommand } from "./use-admin-command";
export function ScheduledSurplus({
  items,
  disabled,
  onSaved,
}: {
  items: readonly ScheduledSurplusView[];
  disabled: boolean;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<ScheduledSurplusView | null>(null),
    [quantity, setQuantity] = useState(""),
    [reason, setReason] = useState(""),
    [inspected, setInspected] = useState(false);
  const command = useAdminCommand();
  return (
    <section aria-label="Unused received goods" className="space-y-3">
      {items.some((item) => item.availableBase > 0 || item.releasedBase > 0) ? (
        <>
          <h2 className="font-semibold">Unused received goods</h2>
          <p className="text-sm text-muted-foreground">
            Paid Orders keep their allocated goods. Inspect any leftovers before adding them to this
            location’s stock.
          </p>
          {items
            .filter((item) => item.availableBase > 0 || item.releasedBase > 0)
            .map((item) => (
              <article
                key={`${item.cycleId}:${item.inventoryPoolId}`}
                className="space-y-2 rounded-lg border p-3 text-sm"
              >
                <p className="font-medium">
                  {item.productName} · {item.cycleName}
                </p>
                <p>
                  {item.availableBase.toLocaleString("en-PH")} {item.unit} unused ·{" "}
                  {item.releasedBase.toLocaleString("en-PH")} {item.unit} released to stock
                </p>
                {item.blockedReason ? <p>{item.blockedReason}</p> : null}
                {item.availableBase > 0 ? (
                  <Button
                    variant="outline"
                    disabled={disabled || !!item.blockedReason || command.busy || command.uncertain}
                    onClick={() => {
                      setSelected(item);
                      setQuantity("");
                      setReason("");
                      setInspected(false);
                      command.setNotice(null);
                    }}
                  >
                    Release inspected surplus
                  </Button>
                ) : null}
              </article>
            ))}
        </>
      ) : null}
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !command.busy && !command.uncertain) setSelected(null);
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Release inspected surplus</SheetTitle>
            <SheetDescription>
              {selected?.productName} · {selected?.cycleName}. Release only goods staff inspected as
              suitable for sale. Spoiled or rejected goods stay out of stock.
            </SheetDescription>
          </SheetHeader>
          {selected ? (
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void (async () => {
                  if (command.uncertain) {
                    if (await command.retry()) {
                      setSelected(null);
                      onSaved();
                    }
                    return;
                  }
                  const quantityBase = Number(quantity);
                  if (
                    !Number.isSafeInteger(quantityBase) ||
                    quantityBase <= 0 ||
                    quantityBase > selected.availableBase ||
                    !inspected ||
                    !reason.trim()
                  ) {
                    command.setNotice(
                      "Enter the inspected quantity and a reason, then confirm it is suitable for sale.",
                    );
                    return;
                  }
                  if (
                    await command.run(
                      `surplus:${selected.cycleId}:${selected.inventoryPoolId}`,
                      "/api/admin/receiving/surplus",
                      {
                        cycleId: selected.cycleId,
                        locationId: selected.locationId,
                        inventoryPoolId: selected.inventoryPoolId,
                        quantityBase,
                        expectedVersion: selected.version,
                        inspected: true,
                        reason: reason.trim(),
                      },
                    )
                  ) {
                    setSelected(null);
                    onSaved();
                  }
                })();
              }}
            >
              <fieldset className="space-y-4" disabled={command.busy || command.uncertain}>
                <label className="grid gap-2 text-sm">
                  Quantity to release ({selected.unit})
                  <Input
                    inputMode="numeric"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  Reason
                  <Input
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={inspected}
                    onChange={(e) => setInspected(e.target.checked)}
                  />
                  I inspected these goods and they are suitable for sale.
                </label>
              </fieldset>
              <Button type="submit" disabled={command.busy}>
                {command.busy ? "Saving…" : "Release to stock"}
              </Button>
              {command.notice ? <p role="status">{command.notice}</p> : null}
            </form>
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}
