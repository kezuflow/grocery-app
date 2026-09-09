"use client";
import { useState } from "react";
import type { ReceivingSessionView, ScheduledCountedReceiptView } from "@freshmarkets/contracts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../ui/sheet";
import { useAdminCommand } from "./use-admin-command";
type Group = {
  productId: string;
  productName: string;
  cycleId: string;
  cycleName: string;
  locationId: string;
  locationLabel: string;
  kind: "DELIVERY" | "REPLACEMENT";
  items: ReceivingSessionView[];
};
export function ScheduledCountedReceiving({
  items,
  receipts,
  locationLabel,
  disabled,
  onSaved,
}: {
  items: readonly ReceivingSessionView[];
  receipts: readonly ScheduledCountedReceiptView[];
  locationLabel: string;
  disabled: boolean;
  onSaved: () => void;
}) {
  const groups = new Map<string, Group>();
  for (const item of items) {
    if (
      item.stockTracking !== "COUNTED_SIZES" ||
      !item.productId ||
      !item.allowedActions?.some((action) => ["START", "RECORD", "REPLACE"].includes(action))
    )
      continue;
    const kind = item.allowedActions.includes("REPLACE") ? "REPLACEMENT" : "DELIVERY";
    const key = `${item.cycleId}:${item.productId}:${kind}`;
    const group = groups.get(key) ?? {
      productId: item.productId,
      productName: item.productName ?? "Produce",
      cycleId: item.cycleId,
      cycleName: item.cycleName ?? "Delivery week",
      locationId: item.locationId,
      locationLabel,
      kind,
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }
  const [selected, setSelected] = useState<Group | null>(null);
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");
  const [counts, setCounts] = useState<
    Record<string, { accepted: string; rejected: string; shortage: string }>
  >({});
  const command = useAdminCommand();
  return (
    <section className="space-y-3" aria-label="Weighed produce receiving">
      {groups.size ? (
        <>
          <h2 className="text-lg font-semibold">Receive and count produce</h2>
          <p className="text-sm text-muted-foreground">
            Record the measured weight and the actual pieces or packs in each size. These goods stay
            with this delivery week.
          </p>
          <div className="flex flex-wrap gap-2">
            {Array.from(groups.entries()).map(([key, group]) => (
              <Button
                key={key}
                variant="outline"
                disabled={disabled || command.busy || command.uncertain}
                onClick={() => {
                  setSelected(group);
                  setCounts({});
                  setWeight("");
                  setNote("");
                  command.setNotice(null);
                }}
              >
                {group.kind === "REPLACEMENT" ? "Receive replacement" : "Receive and count"}{" "}
                {group.productName} · {group.cycleName}
              </Button>
            ))}
          </div>
        </>
      ) : null}
      {receipts.length ? (
        <div className="space-y-2">
          <h2 className="font-semibold">Latest weighed receipts</h2>
          {receipts.map((receipt) => (
            <article key={receipt.receiptId} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">
                {receipt.productName} · {receipt.receivedWeightGrams.toLocaleString("en-PH")} g
                measured{receipt.receiptKind === "REPLACEMENT" ? " · replacement" : ""}
              </p>
              <p>{receipt.cycleName}</p>
              {receipt.lines.map((line) => (
                <p key={line.receivingSessionId}>
                  {line.variantName}: {line.acceptedBase} accepted · {line.rejectedBase} rejected ·{" "}
                  {line.shortageBase} missing
                </p>
              ))}
            </article>
          ))}
        </div>
      ) : null}
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !command.busy && !command.uncertain) setSelected(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {selected?.kind === "REPLACEMENT"
                ? "Receive replacement produce"
                : "Receive and count produce"}
            </SheetTitle>
            <SheetDescription>
              {selected?.productName} · {selected?.cycleName} · {selected?.locationLabel}. Enter
              what staff actually weighed and counted.
            </SheetDescription>
          </SheetHeader>
          {selected ? (
            <form
              className="mt-6 space-y-5"
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
                  const receivedWeightGrams = Number(weight);
                  const lines = selected.items
                    .map((item) => ({
                      receivingSessionId: item.receivingSessionId,
                      expectedVersion: item.version,
                      acceptedBase: Number(counts[item.receivingSessionId]?.accepted ?? ""),
                      rejectedBase:
                        selected.kind === "REPLACEMENT"
                          ? 0
                          : Number(counts[item.receivingSessionId]?.rejected ?? ""),
                      shortageBase:
                        selected.kind === "REPLACEMENT"
                          ? 0
                          : Number(counts[item.receivingSessionId]?.shortage ?? ""),
                    }))
                    .filter(
                      (line) => line.acceptedBase + line.rejectedBase + line.shortageBase !== 0,
                    );
                  if (
                    weight.trim() === "" ||
                    !Number.isSafeInteger(receivedWeightGrams) ||
                    receivedWeightGrams < 0 ||
                    !lines.length ||
                    lines.some(
                      (line) =>
                        ![line.acceptedBase, line.rejectedBase, line.shortageBase].every(
                          (value) => Number.isSafeInteger(value) && value >= 0,
                        ),
                    )
                  ) {
                    command.setNotice(
                      "Enter the measured grams and at least one actual size count or missing quantity.",
                    );
                    return;
                  }
                  if (
                    await command.run(
                      `counted:${selected.productId}:${selected.cycleId}`,
                      "/api/admin/receiving/counted",
                      {
                        locationId: selected.locationId,
                        cycleId: selected.cycleId,
                        productId: selected.productId,
                        receivedWeightGrams,
                        receiptKind: selected.kind,
                        reason: note.trim() || "Supplier goods weighed and counted",
                        lines,
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
                  Received bulk weight (g)
                  <Input
                    value={weight}
                    inputMode="numeric"
                    onChange={(event) => setWeight(event.target.value)}
                  />
                </label>
                {selected.items.map((item) => {
                  const values = counts[item.receivingSessionId] ?? {
                    accepted: "",
                    rejected: "",
                    shortage: "",
                  };
                  return (
                    <div key={item.receivingSessionId} className="space-y-2 rounded-lg border p-3">
                      <h3 className="font-medium">{item.variantName ?? item.productName}</h3>
                      <p className="text-sm text-muted-foreground">
                        Still needed: {item.expectedBase - item.acceptedBase} pieces/packs
                      </p>
                      {(["accepted", "rejected", "shortage"] as const)
                        .filter((field) => selected.kind !== "REPLACEMENT" || field === "accepted")
                        .map((field) => (
                          <label key={field} className="grid gap-1 text-sm">
                            {field === "shortage"
                              ? "Missing"
                              : field === "accepted"
                                ? "Accepted"
                                : "Rejected"}{" "}
                            {item.variantName}
                            <Input
                              inputMode="numeric"
                              value={values[field]}
                              onChange={(event) =>
                                setCounts((current) => ({
                                  ...current,
                                  [item.receivingSessionId]: {
                                    ...values,
                                    [field]: event.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                        ))}
                    </div>
                  );
                })}
                <label className="grid gap-2 text-sm">
                  Receipt note (optional)
                  <Input
                    value={note}
                    maxLength={500}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
              </fieldset>
              <Button type="submit" disabled={command.busy}>
                {command.busy ? "Saving…" : "Save received counts"}
              </Button>
              {command.notice ? <p role="status">{command.notice}</p> : null}
            </form>
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}
