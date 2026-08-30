"use client";

import { useRef, useState } from "react";
import type {
  CustomerOrderIssueCategory,
  CustomerOrderIssueView,
  CustomerOrderLineSnapshot,
  RpcResult,
} from "@freshmarkets/contracts";

const categories: ReadonlyArray<{ value: CustomerOrderIssueCategory; label: string }> = [
  { value: "MISSING_ITEM", label: "Missing item" },
  { value: "WRONG_ITEM", label: "Wrong item" },
  { value: "DAMAGED_ITEM", label: "Damaged item" },
  { value: "POOR_QUALITY", label: "Poor quality" },
  { value: "QUANTITY_DISCREPANCY", label: "Quantity discrepancy" },
  { value: "DELIVERY_ISSUE", label: "Delivery issue" },
  { value: "OTHER", label: "Something else" },
];

function newKey(): string {
  return crypto.randomUUID();
}

export function OrderIssueForm({
  orderId,
  items,
  available,
}: {
  orderId: string;
  items: readonly CustomerOrderLineSnapshot[];
  available: boolean;
}) {
  const [category, setCategory] = useState<CustomerOrderIssueCategory>("MISSING_ITEM");
  const [description, setDescription] = useState("");
  const [affectedIds, setAffectedIds] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const key = useRef<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || state === "submitting") return;
    key.current ??= newKey();
    setState("submitting");
    setMessage("Submitting your issue…");
    try {
      const response = await fetch(`/api/commerce/orders/${encodeURIComponent(orderId)}/issues`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key.current },
        body: JSON.stringify({ category, description, affectedOrderItemIds: affectedIds }),
      });
      const result = (await response.json()) as RpcResult<CustomerOrderIssueView>;
      if (!result.ok) {
        setState("error");
        setMessage(result.error.message);
        return;
      }
      key.current = null;
      setState("success");
      setMessage("Your issue was submitted. Our team will review it.");
      setDescription("");
      setAffectedIds([]);
      requestAnimationFrame(() => statusRef.current?.focus());
    } catch {
      setState("error");
      setMessage("We could not submit the issue. Retry to safely continue the same request.");
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      <div>
        <label htmlFor="issue-category" className="text-sm font-semibold">
          What went wrong?
        </label>
        <select
          id="issue-category"
          value={category}
          onChange={(event) => setCategory(event.target.value as CustomerOrderIssueCategory)}
          disabled={!available || state === "submitting"}
          className="mt-1 block w-full rounded-lg border border-[var(--fm-border)] bg-white px-3 py-2"
        >
          {categories.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <fieldset disabled={!available || state === "submitting"}>
        <legend className="text-sm font-semibold">Affected items</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <label key={item.orderItemId} className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={affectedIds.includes(item.orderItemId)}
                onChange={(event) =>
                  setAffectedIds((current) =>
                    event.target.checked
                      ? [...current, item.orderItemId]
                      : current.filter((id) => id !== item.orderItemId),
                  )
                }
              />
              <span>{item.productName}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="issue-description" className="text-sm font-semibold">
          Describe the issue
        </label>
        <textarea
          id="issue-description"
          required
          maxLength={1000}
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={!available || state === "submitting"}
          aria-describedby="issue-character-count"
          className="mt-1 block w-full rounded-lg border border-[var(--fm-border)] px-3 py-2"
        />
        <p id="issue-character-count" className="mt-1 text-xs text-[var(--fm-text-muted)]">
          {description.length}/1000 characters
        </p>
      </div>
      <button
        type="submit"
        disabled={!available || state === "submitting" || !description.trim()}
        className="rounded-lg bg-[var(--fm-ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {state === "submitting" ? "Submitting…" : "Submit issue"}
      </button>
      {!available ? (
        <p className="text-sm text-[var(--fm-text-muted)]">Issue reporting is unavailable.</p>
      ) : null}
      {message ? (
        <p
          ref={statusRef}
          tabIndex={-1}
          role={state === "error" ? "alert" : "status"}
          className="text-sm"
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
