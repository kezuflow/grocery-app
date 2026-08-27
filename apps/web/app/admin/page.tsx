"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PackageCheck,
  Boxes,
  Truck,
  ClipboardList,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import {
  FilterBar,
  ListPageSection,
  PageHeader,
  StatusBadge,
} from "../../components/admin/admin-shell";
import type {
  AdminOperationsBoardValue,
  DeliveryDispatchItem,
  FulfillmentQueueItem,
  ProcurementQueueItem,
} from "@freshmarkets/contracts";

type BoardState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; board: AdminOperationsBoardValue };

const sectionMeta: Record<string, { title: string; description: string }> = {
  fulfillment: {
    title: "Fulfillment queue",
    description: "Pick, pack, and shortage decisions in commitment order.",
  },
  delivery: {
    title: "Delivery dispatch",
    description: "Assign riders, dispatch, and resolve failed deliveries.",
  },
  procurement: {
    title: "Procurement & receiving",
    description: "Committed demand against receiving progress per pool.",
  },
};

function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 10)}…`;
}

/**
 * One logical command carries one stable idempotency key for its lifetime;
 * the key is replaced only after a terminal outcome (success or stale
 * version), so a double-click or network retry replays the same command
 * instead of duplicating it. After any terminal outcome the board refreshes.
 */
function useCommandRunner(refresh: () => void) {
  const keys = useRef(new Map<string, string>());
  return useCallback(
    async (route: string, body: Record<string, unknown>, version: number) => {
      const actionId = `${route}:${JSON.stringify(body)}`;
      let key = keys.current.get(actionId);
      if (!key) {
        key = crypto.randomUUID();
        keys.current.set(actionId, key);
      }
      const response = await fetch(`${route}?v=${encodeURIComponent(String(version))}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        error?: { code?: string; message?: string };
      };
      if (payload.ok || payload.error?.code === "STALE_VERSION") {
        keys.current.delete(actionId);
        refresh();
      }
      return payload;
    },
    [refresh],
  );
}

export default function AdminPage() {
  const [state, setState] = useState<BoardState>({ phase: "loading" });
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/operations")
      .then(
        (r) =>
          r.json() as Promise<{
            ok: boolean;
            value?: AdminOperationsBoardValue;
            error?: { code: string; message: string };
          }>,
      )
      .then((payload) => {
        if (payload.ok && payload.value) setState({ phase: "ready", board: payload.value });
        else
          setState({
            phase: "error",
            message:
              payload.error?.code === "UNAUTHENTICATED"
                ? "Sign in with a staff account to view operational queues."
                : payload.error?.code === "FORBIDDEN"
                  ? "Your role has no operational capability at this location."
                  : (payload.error?.message ?? "The operations board could not be loaded."),
          });
      })
      .catch(() => setState({ phase: "error", message: "Network error loading the board." }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runCommand = useCommandRunner(load);

  async function fulfillmentAction(
    item: FulfillmentQueueItem,
    action: "START" | "PACK" | "SHORTAGE",
  ) {
    const result = await runCommand(
      "/api/admin/delivery",
      { orderId: item.orderId, command: "fulfillment", action },
      item.version,
    );
    setNotice(result.ok ? null : (result.error?.message ?? "Command failed."));
  }

  async function deliveryAction(
    item: DeliveryDispatchItem,
    action: "DISPATCH" | "DELIVER" | "FAIL",
  ) {
    const result = await runCommand(
      "/api/admin/delivery",
      { orderId: item.orderId, command: "delivery", action },
      item.version,
    );
    setNotice(result.ok ? null : (result.error?.message ?? "Command failed."));
  }

  async function assignRider(item: DeliveryDispatchItem, riderAuthUserId: string) {
    if (!riderAuthUserId.trim()) {
      setNotice("Enter the rider's user ID to assign.");
      return;
    }
    const result = await runCommand(
      "/api/admin/rider-assign",
      { orderId: item.orderId, riderAuthUserId: riderAuthUserId.trim() },
      item.version,
    );
    setNotice(result.ok ? null : (result.error?.message ?? "Assignment failed."));
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Operations board"
        description="Location-scoped queues, exceptions, and the legal actions for this shift."
        action={<Badge>Scoped by Core IAM</Badge>}
      />
      <FilterBar>
        <span className="text-xs text-[var(--fm-text-muted)]">
          {state.phase === "ready" ? `Location: ${state.board.locationId}` : "Loading context…"}
        </span>
      </FilterBar>

      {state.phase === "loading" ? (
        <ListPageSection title="Operations board">
          <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
            Loading operational queues…
          </p>
        </ListPageSection>
      ) : null}

      {state.phase === "error" ? (
        <ListPageSection title="Operations board unavailable">
          <p className="flex items-center gap-2 p-5 text-sm" role="alert">
            <AlertCircle className="size-4 text-red-600" aria-hidden />
            {state.message}
          </p>
        </ListPageSection>
      ) : null}

      {state.phase === "ready" ? (
        <>
          {notice ? (
            <p
              role="status"
              className="rounded border border-[var(--fm-border)] bg-white p-3 text-sm"
            >
              {notice}
            </p>
          ) : null}
          {state.board.sectionsDenied.length > 0 ? (
            <ListPageSection title="Sections not permitted for your role">
              <p className="flex flex-wrap items-center gap-2 p-5 text-sm text-[var(--fm-text-muted)]">
                {state.board.sectionsDenied.map((section) => (
                  <StatusBadge key={section} tone="neutral">
                    {section} denied
                  </StatusBadge>
                ))}
              </p>
            </ListPageSection>
          ) : null}

          <ListPageSection
            title={sectionMeta.fulfillment.title}
            description={sectionMeta.fulfillment.description}
          >
            {state.board.fulfillment.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]">No open fulfillment work.</p>
            ) : (
              <ul className="divide-y divide-[var(--fm-border)]">
                {state.board.fulfillment.map((item) => (
                  <li
                    key={item.orderId}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
                  >
                    <ClipboardList className="size-4 text-[var(--fm-text-muted)]" aria-hidden />
                    <span className="font-mono text-sm">{shortId(item.orderId)}</span>
                    <StatusBadge tone={item.status === "SHORTAGE" ? "warning" : "info"}>
                      {item.status}
                    </StatusBadge>
                    <span className="text-xs text-[var(--fm-text-muted)]">v{item.version}</span>
                    <span className="ml-auto flex gap-2">
                      {item.allowedActions.map((action) => (
                        <Button
                          key={action}
                          size="sm"
                          variant={action === "SHORTAGE" ? "outline" : "default"}
                          onClick={() => fulfillmentAction(item, action)}
                        >
                          {action === "START"
                            ? "Start picking"
                            : action === "PACK"
                              ? "Mark packed"
                              : "Report shortage"}
                        </Button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ListPageSection>

          <ListPageSection
            title={sectionMeta.delivery.title}
            description={sectionMeta.delivery.description}
          >
            {state.board.delivery.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]">No open delivery jobs.</p>
            ) : (
              <ul className="divide-y divide-[var(--fm-border)]">
                {state.board.delivery.map((item) => (
                  <li key={item.jobId} className="px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <Truck className="size-4 text-[var(--fm-text-muted)]" aria-hidden />
                      <span className="font-mono text-sm">{shortId(item.orderId)}</span>
                      <StatusBadge tone={item.status === "FAILED" ? "warning" : "info"}>
                        {item.status}
                      </StatusBadge>
                      <span className="text-xs text-[var(--fm-text-muted)]">
                        {item.riderAuthUserId
                          ? `Rider ${shortId(item.riderAuthUserId)}`
                          : "Unassigned"}
                      </span>
                      <span className="text-xs text-[var(--fm-text-muted)]">v{item.version}</span>
                      <span className="ml-auto flex flex-wrap items-center gap-2">
                        <AssignControl item={item} onAssign={assignRider} />
                        {item.allowedActions.map((action) => (
                          <Button
                            key={action}
                            size="sm"
                            variant={action === "FAIL" ? "outline" : "default"}
                            onClick={() => deliveryAction(item, action)}
                          >
                            {action === "DISPATCH"
                              ? "Dispatch"
                              : action === "DELIVER"
                                ? "Delivered"
                                : "Fail"}
                          </Button>
                        ))}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ListPageSection>

          <ListPageSection
            title={sectionMeta.procurement.title}
            description={sectionMeta.procurement.description}
          >
            {state.board.procurement.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]">
                No procurement requirements.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--fm-border)]">
                {state.board.procurement.map((item: ProcurementQueueItem) => (
                  <li
                    key={item.requirementId}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
                  >
                    <Boxes className="size-4 text-[var(--fm-text-muted)]" aria-hidden />
                    <span className="font-mono text-sm">{shortId(item.requirementId)}</span>
                    <StatusBadge tone={item.receivingStatus === null ? "neutral" : "info"}>
                      {item.requirementStatus}
                      {item.receivingStatus ? ` · ${item.receivingStatus}` : ""}
                    </StatusBadge>
                    <span className="text-xs text-[var(--fm-text-muted)]">
                      expected {item.requiredQuantityBase} · accepted {item.acceptedBase} · rejected{" "}
                      {item.rejectedBase}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ListPageSection>

          <ListPageSection
            title="Exception queue"
            description="Shortages, failed deliveries, and receiving discrepancies needing resolution."
          >
            {state.board.exceptions.length === 0 ? (
              <p className="flex items-center gap-2 p-5 text-sm text-[var(--fm-text-muted)]">
                <StatusBadge tone="success">Clear</StatusBadge> No active exceptions.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--fm-border)]">
                {state.board.exceptions.map((exception) => (
                  <li
                    key={`${exception.kind}-${exception.referenceId}`}
                    className="flex items-start gap-3 px-4 py-3 sm:px-5"
                  >
                    <AlertCircle className="mt-0.5 size-4 text-amber-600" aria-hidden />
                    <div>
                      <p className="text-sm font-semibold">{exception.kind.replaceAll("_", " ")}</p>
                      <p className="mt-0.5 text-xs text-[var(--fm-text-muted)]">
                        {exception.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ListPageSection>
        </>
      ) : null}
    </div>
  );
}

function AssignControl({
  item,
  onAssign,
}: {
  item: DeliveryDispatchItem;
  onAssign: (item: DeliveryDispatchItem, riderAuthUserId: string) => void;
}) {
  const [riderId, setRiderId] = useState("");
  return (
    <span className="flex items-center gap-1">
      <input
        aria-label={`Rider user ID for order ${item.orderId}`}
        placeholder="Rider user ID"
        value={riderId}
        onChange={(event) => setRiderId(event.target.value)}
        className="w-40 rounded border border-[var(--fm-border)] p-1 text-xs"
      />
      <Button size="sm" variant="outline" onClick={() => onAssign(item, riderId)}>
        Assign
      </Button>
    </span>
  );
}
