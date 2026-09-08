"use client";
import { useCallback, useEffect, useState } from "react";
import {
  customerClosureRequestTypes,
  privacyRequestActions,
  privacyRequestStatuses,
  type CustomerClosureRequestType,
  type PrivacyRequestAction,
  type PrivacyRequestPage,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import type { useAdminCommand } from "./use-admin-command";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { ListPageSection } from "./admin-shell";

const resultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.object({
      items: z.array(
        z.object({
          privacyRequestId: z.string(),
          customerId: z.string(),
          requestType: z.enum(customerClosureRequestTypes),
          status: z.enum(privacyRequestStatuses),
          requestedAt: z.string(),
          verifiedAt: z.string().nullable(),
          resolvedAt: z.string().nullable(),
          assignedStaffId: z.string().nullable(),
          reason: z.string().nullable(),
          resolution: z.string().nullable(),
          version: z.number().int().positive(),
          availableActions: z.array(z.enum(privacyRequestActions)),
        }),
      ),
      nextCursor: z.string().nullable(),
    }),
  }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);
const actionLabels: Record<PrivacyRequestAction, string> = {
  VERIFY: "Begin identity review",
  APPROVE: "Approve request",
  REJECT: "Reject request",
  BEGIN_PROCESSING: "Begin processing",
  COMPLETE: "Record manual completion",
  ESCALATE: "Escalate request",
};
const typeLabels: Record<CustomerClosureRequestType, string> = {
  ACCESS: "Data access",
  CORRECTION: "Data correction",
  CLOSURE: "Commerce access closure",
  ANONYMIZATION: "Anonymization review",
};

export function CustomerPrivacyPanel({
  customerId,
  command,
  onChanged,
}: {
  customerId: string;
  command: ReturnType<typeof useAdminCommand>;
  onChanged: () => void;
}) {
  const [page, setPage] = useState<PrivacyRequestPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestType, setRequestType] = useState<CustomerClosureRequestType>("CLOSURE");
  const [reason, setReason] = useState("");
  const [actionReasons, setActionReasons] = useState<Record<string, string>>({});
  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ customerId, limit: "10" });
        if (cursor) params.set("cursor", cursor);
        const result = resultSchema.parse(
          await (await fetch(`/api/admin/privacy-requests?${params}`)).json(),
        );
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        setPage((previous) =>
          cursor && previous
            ? {
                items: [...previous.items, ...result.value.items],
                nextCursor: result.value.nextCursor,
              }
            : result.value,
        );
      } catch {
        setError("Privacy requests could not be loaded. Please retry.");
      } finally {
        setLoading(false);
      }
    },
    [customerId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <ListPageSection
      title="Closure and privacy requests"
      description="Review the customer's request and record the work performed. Retained commerce and audit history is preserved."
    >
      <div className="space-y-4 p-4">
        <fieldset disabled={command.busy || command.uncertain} className="space-y-3">
          <Select
            value={requestType}
            onValueChange={(value) => {
              const parsed = z.enum(customerClosureRequestTypes).safeParse(value);
              if (parsed.success) setRequestType(parsed.data);
            }}
          >
            <SelectTrigger aria-label="Privacy request type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {customerClosureRequestTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {typeLabels[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            aria-label="Privacy request reason"
            placeholder="Describe the customer's request"
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button
            disabled={!reason.trim()}
            onClick={async () => {
              if (
                await command.run(
                  `privacy-create:${customerId}`,
                  `/api/admin/customers/${encodeURIComponent(customerId)}/closure-requests`,
                  { requestType, reason: reason.trim() },
                )
              )
                onChanged();
            }}
          >
            Open privacy request
          </Button>
        </fieldset>
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <Button variant="outline" disabled={loading} onClick={() => void load()}>
              Retry privacy requests
            </Button>
          </div>
        ) : null}
        {loading && !page ? <p role="status">Loading privacy requests…</p> : null}
        {page?.items.length === 0 ? <p>No privacy requests recorded.</p> : null}
        {page?.items.map((item) => (
          <article
            key={item.privacyRequestId}
            className="space-y-3 rounded border p-3"
            aria-label={`${typeLabels[item.requestType]} request`}
          >
            <h3 className="font-semibold">{typeLabels[item.requestType]}</h3>
            <p>
              Status: {item.status} · Version {item.version}
            </p>
            <p className="whitespace-pre-wrap break-words">{item.reason}</p>
            {item.resolution ? (
              <p className="whitespace-pre-wrap break-words">Resolution: {item.resolution}</p>
            ) : null}
            {item.requestType === "CLOSURE" ? (
              <p className="text-sm">
                Completion disables commerce access and revokes current sessions. It does not erase
                retained records.
              </p>
            ) : item.requestType === "ANONYMIZATION" ? (
              <p className="text-sm">
                Anonymization completion is unavailable until approved retention and field policy is
                configured.
              </p>
            ) : (
              <p className="text-sm">
                Complete the response or correction outside this queue before recording its
                completion. Describe that evidence in the action reason.
              </p>
            )}
            {item.availableActions.length ? (
              <fieldset disabled={command.busy || command.uncertain} className="space-y-2">
                <Textarea
                  aria-label={`Action reason for ${typeLabels[item.requestType]} request`}
                  maxLength={500}
                  value={actionReasons[item.privacyRequestId] ?? ""}
                  onChange={(event) =>
                    setActionReasons((previous) => ({
                      ...previous,
                      [item.privacyRequestId]: event.target.value,
                    }))
                  }
                />
                <div className="flex flex-wrap gap-2">
                  {item.availableActions.map((action) => (
                    <Button
                      key={action}
                      variant={
                        action === "COMPLETE" && item.requestType === "CLOSURE"
                          ? "destructive"
                          : "outline"
                      }
                      disabled={!actionReasons[item.privacyRequestId]?.trim()}
                      onClick={async () => {
                        if (
                          await command.run(
                            `privacy-action:${item.privacyRequestId}`,
                            `/api/admin/privacy-requests/${encodeURIComponent(item.privacyRequestId)}/actions`,
                            {
                              action,
                              expectedVersion: item.version,
                              reason: actionReasons[item.privacyRequestId]?.trim(),
                            },
                          )
                        )
                          onChanged();
                      }}
                    >
                      {action === "COMPLETE" && item.requestType === "CLOSURE"
                        ? "Close commerce access"
                        : actionLabels[action]}
                    </Button>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </article>
        ))}
        {page?.nextCursor ? (
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => void load(page.nextCursor ?? undefined)}
          >
            Load more privacy requests
          </Button>
        ) : null}
      </div>
    </ListPageSection>
  );
}
