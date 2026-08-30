"use client";

import { GripVertical } from "lucide-react";
import { useRef } from "react";
import { Button } from "../../ui/button";

export type OrderedDeliveryItem = Readonly<{
  jobId: string;
  status: string;
  version: number;
}>;

export function DeliveryOrderList({
  deliveries,
  onReorder,
}: {
  deliveries: ReadonlyArray<OrderedDeliveryItem>;
  onReorder: (deliveries: ReadonlyArray<OrderedDeliveryItem>) => void;
}) {
  const draggedId = useRef<string | null>(null);

  function move(index: number, offset: number) {
    const destination = index + offset;
    if (destination < 0 || destination >= deliveries.length) return;
    const next = [...deliveries];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(destination, 0, item);
    onReorder(next);
    queueMicrotask(() =>
      document.querySelector<HTMLButtonElement>(`[data-order-focus="${item.jobId}"]`)?.focus(),
    );
  }

  function drop(targetId: string) {
    const sourceId = draggedId.current;
    draggedId.current = null;
    if (!sourceId || sourceId === targetId) return;
    const source = deliveries.find((item) => item.jobId === sourceId);
    const targetIndex = deliveries.findIndex((item) => item.jobId === targetId);
    if (!source || targetIndex < 0) return;
    const next = deliveries.filter((item) => item.jobId !== sourceId);
    next.splice(targetIndex, 0, source);
    onReorder(next);
  }

  return (
    <ol aria-label="Manual delivery order" className="space-y-2">
      {deliveries.map((delivery, index) => (
        <li
          key={delivery.jobId}
          draggable
          onDragStart={() => (draggedId.current = delivery.jobId)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => drop(delivery.jobId)}
          className="flex min-h-11 items-center gap-2 rounded border border-[var(--fm-border)] bg-white p-2"
        >
          <GripVertical className="size-4 text-[var(--fm-text-muted)]" aria-hidden="true" />
          <span className="w-6 font-semibold">{index + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-xs">{delivery.jobId}</span>
            <span className="text-xs text-[var(--fm-text-muted)]">
              {delivery.status} · version {delivery.version}
            </span>
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={`Move ${delivery.jobId} up`}
            disabled={index === 0}
            onClick={() => move(index, -1)}
          >
            ↑
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={`Move ${delivery.jobId} down`}
            data-order-focus={delivery.jobId}
            disabled={index === deliveries.length - 1}
            onClick={() => move(index, 1)}
          >
            ↓
          </Button>
        </li>
      ))}
    </ol>
  );
}
