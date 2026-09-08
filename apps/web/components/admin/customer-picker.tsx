"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "@freshmarkets/validation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { catalogResultSchema } from "./catalog-command-state";

export type CustomerChoice = { customerId: string; label: string };
const resultSchema = catalogResultSchema(
  z.object({
    items: z.array(
      z.object({
        customerId: z.string(),
        email: z.string(),
        phone: z.string().nullable(),
        accessStatus: z.enum(["active", "disabled"]),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
);

/** Named selection over the existing capability-checked Customer read model. */
export function CustomerPicker({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: CustomerChoice | null;
  onChange: (value: CustomerChoice | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<CustomerChoice[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function search() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setNotice(null);
    setChoices([]);
    try {
      const response = await fetch(
        `/api/admin/customers?limit=20&query=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal },
      );
      const payload = resultSchema.parse(await response.json());
      if (controller.signal.aborted) return;
      if (!payload.ok) {
        setNotice(payload.error.message);
        return;
      }
      const active = payload.value.items.filter((item) => item.accessStatus === "active");
      setChoices(
        active.map((item) => ({
          customerId: item.customerId,
          label: item.phone ? `${item.email} (${item.phone})` : item.email,
        })),
      );
      setNotice(
        active.length === 0
          ? "No active customers found."
          : payload.value.nextCursor
            ? "More results are available. Refine the search to find the customer."
            : null,
      );
    } catch {
      if (!controller.signal.aborted)
        setNotice("Customers could not be loaded. Try searching again.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  return (
    <div className="min-w-0 space-y-2">
      <label className="grid gap-1 text-sm font-medium">
        {label}
        <Input
          aria-label={label}
          placeholder="Search email or phone"
          value={query}
          disabled={disabled}
          maxLength={200}
          onChange={(event) => {
            abort.current?.abort();
            setLoading(false);
            setChoices([]);
            setNotice(null);
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void search();
            }
          }}
        />
      </label>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || loading}
        onClick={() => void search()}
      >
        {" "}
        {loading ? "Searching customers..." : `Search ${label.toLowerCase()}`}
      </Button>
      {value ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="break-all">Selected: {value.label}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            Clear {label.toLowerCase()}
          </Button>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      {choices.length ? (
        <ul aria-label={`${label} results`} className="max-h-56 overflow-auto rounded-md border">
          {choices.map((choice) => (
            <li key={choice.customerId}>
              <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                className="h-auto w-full justify-start whitespace-normal break-all text-left"
                onClick={() => {
                  onChange(choice);
                  setChoices([]);
                  setQuery("");
                  setNotice(null);
                }}
              >
                {choice.label}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
