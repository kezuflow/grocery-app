"use client";
import { useEffect, useState } from "react";
import type { AdminPromotionAudienceView, AdminPromotionRule } from "@freshmarkets/contracts";
import {
  adminPromotionAudienceBodySchema,
  adminPromotionAudienceSchema,
  adminPromotionAudienceViewSchema,
} from "@freshmarkets/validation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { CustomerPicker } from "./customer-picker";
import { catalogResultSchema, useCatalogCommand } from "./catalog-command-state";
const names = {
  FIRST_ORDER: "First order",
  NEW_CUSTOMER: "New customer",
  MINIMUM_SUBTOTAL: "Minimum merchandise purchase",
  CUSTOMER_SEGMENT: "Customer segment",
  SPECIFIC_CUSTOMERS: "Selected customers",
};
const kinds = [
  "FIRST_ORDER",
  "NEW_CUSTOMER",
  "MINIMUM_SUBTOTAL",
  "CUSTOMER_SEGMENT",
  "SPECIFIC_CUSTOMERS",
] as const;
function initialRule(type: keyof typeof names): AdminPromotionRule {
  if (type === "MINIMUM_SUBTOTAL") return { type, parameters: { minimumMinor: 0 } };
  if (type === "CUSTOMER_SEGMENT") return { type, parameters: { segmentId: "" } };
  if (type === "SPECIFIC_CUSTOMERS") return { type, parameters: { customerIds: [] } };
  return { type, parameters: {} };
}
function MinimumPurchaseInput({
  value,
  onChange,
  label,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  disabled: boolean;
}) {
  const [text, setText] = useState((value / 100).toFixed(2));
  const parse = (raw: string) =>
    /^\d+(\.\d{1,2})?$/.test(raw) ? Math.round(Number(raw) * 100) : NaN;
  useEffect(() => {
    setText((current) =>
      Object.is(parse(current), value)
        ? current
        : Number.isFinite(value)
          ? (value / 100).toFixed(2)
          : "",
    );
  }, [value]);
  return (
    <Input
      aria-label={label}
      value={text}
      disabled={disabled}
      inputMode="decimal"
      onChange={(event) => {
        setText(event.target.value);
        onChange(parse(event.target.value));
      }}
    />
  );
}
export function PromotionAudienceEditor({
  promotionId,
  status,
  version,
  onSaved,
}: {
  promotionId: string;
  status: string;
  version: number;
  onSaved: () => void;
}) {
  const [view, setView] = useState<AdminPromotionAudienceView | null>(null);
  const [rules, setRules] = useState<AdminPromotionRule[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [replaceUnsupported, setReplaceUnsupported] = useState(false);
  const [segmentQuery, setSegmentQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const command = useCatalogCommand(adminPromotionAudienceSchema);
  const frozen = command.pending || command.uncertain;
  const url = `/api/admin/promotions/${encodeURIComponent(promotionId)}/audience`;
  useEffect(() => {
    const controller = new AbortController();
    setView(null);
    setNotice(null);
    setReplaceUnsupported(false);
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        const result = catalogResultSchema(adminPromotionAudienceViewSchema).parse(
          await response.json(),
        );
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setNotice(result.error.message);
          return;
        }
        setView(result.value);
        setRules(result.value.rules);
      } catch {
        if (!controller.signal.aborted)
          setNotice("Audience could not be loaded. Reload the campaign to try again.");
      }
    })();
    return () => controller.abort();
  }, [url, version]);
  function change(index: number, rule: AdminPromotionRule) {
    setRules((current) => current.map((existing, i) => (i === index ? rule : existing)));
  }
  async function save() {
    if (!view) return;
    const body = adminPromotionAudienceBodySchema.safeParse({
      rules,
      expectedVersion: view.version,
    });
    if (!body.success) {
      setNotice(
        "Complete each condition. Choose at least one customer for selected-customer conditions, and use nonnegative amounts with at most two decimal places.",
      );
      return;
    }
    try {
      const result = await command.submit(url, body.data, "PATCH").catch(() => command.retry());
      if (!result) return;
      if (!result.ok) {
        setNotice(result.error.message);
        return;
      }
      setNotice("Audience saved.");
      onSaved();
    } catch {
      setNotice("Audience could not be confirmed. Save again to retry the same change.");
    }
  }
  if (!view)
    return (
      <p role="status" className="p-4 text-sm">
        {notice ?? "Loading campaign audience..."}
      </p>
    );
  return (
    <div className="space-y-4 p-4">
      <p className="text-sm text-[var(--fm-text-muted)]">
        Customers must match every condition. With no conditions, all customers may qualify.
        Campaign dates, minimum purchase and redemption limits still apply.
      </p>
      {view.unsupportedRuleCount > 0 ? (
        <div className="space-y-2 text-sm">
          <p>
            This campaign has retired or invalid conditions and cannot be activated until they are
            replaced.
          </p>
          {status === "DRAFT" ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={frozen}
                checked={replaceUnsupported}
                onChange={(event) => setReplaceUnsupported(event.target.checked)}
              />
              Replace unsupported conditions with the conditions below
            </label>
          ) : null}
        </div>
      ) : null}
      {rules.length === 0 ? <p className="text-sm">No audience conditions.</p> : null}
      {rules.map((rule, index) => (
        <div key={index} className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            {status === "DRAFT" ? (
              <Select
                value={rule.type}
                disabled={frozen}
                onValueChange={(value) => {
                  const kind = kinds.find((type) => type === value);
                  if (kind) change(index, initialRule(kind));
                }}
              >
                <SelectTrigger aria-label={`Condition ${index + 1}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((type) => (
                    <SelectItem key={type} value={type}>
                      {names[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="font-medium">{names[rule.type]}</p>
            )}
            {status === "DRAFT" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={frozen}
                onClick={() => setRules((current) => current.filter((_, i) => i !== index))}
              >
                Remove condition {index + 1}
              </Button>
            ) : null}
          </div>
          {rule.type === "MINIMUM_SUBTOTAL" ? (
            <label className="grid gap-1 text-sm">
              Minimum purchase (pesos)
              <MinimumPurchaseInput
                label={`Condition ${index + 1} minimum purchase`}
                value={rule.parameters.minimumMinor}
                disabled={frozen || status !== "DRAFT"}
                onChange={(minimumMinor) =>
                  change(index, { type: "MINIMUM_SUBTOTAL", parameters: { minimumMinor } })
                }
              />
            </label>
          ) : null}
          {rule.type === "CUSTOMER_SEGMENT" ? (
            <div className="space-y-2">
              {status === "DRAFT" ? (
                <>
                  <label className="grid gap-1 text-sm">
                    Find a segment
                    <Input
                      aria-label={`Condition ${index + 1} segment search`}
                      value={segmentQuery}
                      disabled={frozen || searching}
                      onChange={(event) => setSegmentQuery(event.target.value)}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={frozen || searching}
                    onClick={async () => {
                      setSearching(true);
                      try {
                        const response = await fetch(
                          `${url}?segmentQuery=${encodeURIComponent(segmentQuery)}`,
                        );
                        const result = catalogResultSchema(adminPromotionAudienceViewSchema).parse(
                          await response.json(),
                        );
                        if (result.ok)
                          setView((current) =>
                            current
                              ? {
                                  ...current,
                                  segments: result.value.segments,
                                  moreSegments: result.value.moreSegments,
                                }
                              : current,
                          );
                        else setNotice(result.error.message);
                      } catch {
                        setNotice("Segments could not be loaded. Try searching again.");
                      } finally {
                        setSearching(false);
                      }
                    }}
                  >
                    Search segments
                  </Button>
                  <Select
                    value={rule.parameters.segmentId}
                    disabled={frozen}
                    onValueChange={(segmentId) =>
                      change(index, { type: "CUSTOMER_SEGMENT", parameters: { segmentId } })
                    }
                  >
                    <SelectTrigger aria-label={`Condition ${index + 1} segment`}>
                      <SelectValue placeholder="Choose an active segment" />
                    </SelectTrigger>
                    <SelectContent>
                      {view.segments.map((segment) => (
                        <SelectItem key={segment.segmentId} value={segment.segmentId}>
                          {segment.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {view.segments.length === 0 ? (
                    <p className="text-sm">No active segments found.</p>
                  ) : null}
                  {view.moreSegments ? (
                    <p className="text-sm">
                      Refine the segment search to see more matching choices.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm">
                  {view.segments.find((segment) => segment.segmentId === rule.parameters.segmentId)
                    ?.name ?? "Segment is unavailable in the current choices."}
                </p>
              )}
            </div>
          ) : null}
          {rule.type === "SPECIFIC_CUSTOMERS" ? (
            <div className="space-y-2">
              <ul className="space-y-2 text-sm">
                {rule.parameters.customerIds.map((customerId) => (
                  <li key={customerId} className="flex flex-wrap items-center gap-2">
                    <span className="break-all">
                      {view.customers.find((customer) => customer.customerId === customerId)
                        ?.label ?? "Customer details require customer-read access"}
                    </span>
                    {status === "DRAFT" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={frozen}
                        onClick={() =>
                          change(index, {
                            type: "SPECIFIC_CUSTOMERS",
                            parameters: {
                              customerIds: rule.parameters.customerIds.filter(
                                (id) => id !== customerId,
                              ),
                            },
                          })
                        }
                      >
                        Remove customer
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {status === "DRAFT" ? (
                <CustomerPicker
                  label={`Eligible customer ${index + 1}`}
                  value={null}
                  disabled={frozen || rule.parameters.customerIds.length >= 20}
                  onChange={(customer) => {
                    if (!customer || rule.parameters.customerIds.includes(customer.customerId))
                      return;
                    change(index, {
                      type: "SPECIFIC_CUSTOMERS",
                      parameters: {
                        customerIds: [...rule.parameters.customerIds, customer.customerId],
                      },
                    });
                    setView((current) =>
                      current
                        ? { ...current, customers: [...current.customers, customer] }
                        : current,
                    );
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
      {status === "DRAFT" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={frozen || rules.length >= 10}
            onClick={() => setRules((current) => [...current, initialRule("FIRST_ORDER")])}
          >
            Add condition
          </Button>
          <Button
            type="button"
            disabled={command.pending || (view.unsupportedRuleCount > 0 && !replaceUnsupported)}
            onClick={() => void save()}
          >
            Save audience
          </Button>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
