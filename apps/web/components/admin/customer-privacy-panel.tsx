"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { AdminConfirmationDialog } from "./admin-controls";
import { useAdminRouteGuard } from "./use-admin-route-guard";
import { useAdminScopeGuard } from "@/app/admin/admin-context-provider";

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
  canManage,
  onChanged,
}: {
  customerId: string;
  command: ReturnType<typeof useAdminCommand>;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [page, setPage] = useState<PrivacyRequestPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestType, setRequestType] = useState<CustomerClosureRequestType>("CLOSURE");
  const [reason, setReason] = useState("");
  const [actionReasons, setActionReasons] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{
    item: PrivacyRequestPage["items"][number];
    action: PrivacyRequestAction;
  } | null>(null);
  const generation = useRef(0);
  const load = useCallback(
    async (cursor?: string) => {
      const current = ++generation.current;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ customerId, limit: "10" });
        if (cursor) params.set("cursor", cursor);
        const result = resultSchema.parse(
          await (await fetch(`/api/admin/privacy-requests?${params}`)).json(),
        );
        if (current !== generation.current) return;
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
        if (current === generation.current)
          setError("Privacy requests could not be loaded. Please retry.");
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [customerId],
  );
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  const dirty =
    canManage &&
    (requestType !== "CLOSURE" ||
      reason.trim().length > 0 ||
      Object.values(actionReasons).some((value) => value.trim().length > 0));
  const locked = command.busy || command.uncertain;
  useAdminScopeGuard(dirty, locked, () => {
    setRequestType("CLOSURE");
    setReason("");
    setActionReasons({});
    setConfirming(null);
  });
  useAdminRouteGuard(dirty, locked);

  async function applyAction(
    item: PrivacyRequestPage["items"][number],
    action: PrivacyRequestAction,
    actionReason: string,
  ) {
    if (!canManage) return;
    const applied = await command.run(
      `privacy-action:${item.privacyRequestId}`,
      `/api/admin/privacy-requests/${encodeURIComponent(item.privacyRequestId)}/actions`,
      { action, expectedVersion: item.version, reason: actionReason },
      "POST",
      {
        title:
          action === "APPROVE"
            ? "Privacy request approved"
            : action === "REJECT"
              ? "Privacy request rejected"
              : action === "COMPLETE"
                ? "Privacy request completed"
                : "Privacy request updated",
      },
    );
    setConfirming(null);
    if (applied) onChanged();
  }

  const confirmation = confirming
    ? confirming.action === "REJECT"
      ? {
          title: "Reject this privacy request?",
          consequence:
            "The request will be recorded as rejected with this reason. Customer access, retained records, Orders and financial records stay unchanged.",
          label: "Reject request",
        }
      : confirming.item.requestType === "CLOSURE"
        ? {
            title: "Close commerce access?",
            consequence:
              "This disables commerce access and revokes the reviewed current sessions. Retained records remain, and this does not cancel Orders or initiate financial effects.",
            label: "Close commerce access",
          }
        : {
            title: `Complete ${typeLabels[confirming.item.requestType].toLowerCase()} request?`,
            consequence:
              "This records that the manual response or correction was completed. It does not export data, change arbitrary profile fields, cancel Orders or initiate financial effects.",
            label: "Record manual completion",
          }
    : null;
  return (
    <ListPageSection
      title="Closure and privacy requests"
      description="Review the customer's request and record the work performed. Retained commerce and audit history is preserved."
    >
      <div className="space-y-4 p-4">
        {canManage ? (
          <fieldset disabled={locked} className="space-y-3">
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
                    "POST",
                    { title: "Privacy request opened" },
                  )
                )
                  onChanged();
              }}
            >
              Open privacy request
            </Button>
          </fieldset>
        ) : (
          <p className="text-sm text-[var(--fm-text-muted)]">
            Privacy requests are read-only without customers.manage.
          </p>
        )}
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
            <p>Status: {item.status}</p>
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
            {canManage && item.availableActions.length ? (
              <fieldset disabled={locked} className="space-y-2">
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
                      onClick={() => {
                        const actionReason = actionReasons[item.privacyRequestId]?.trim();
                        if (!actionReason) return;
                        if (action === "REJECT" || action === "COMPLETE") {
                          setConfirming({ item, action });
                          return;
                        }
                        void applyAction(item, action, actionReason);
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
            <details className="text-xs text-[var(--fm-text-muted)]">
              <summary className="cursor-pointer font-medium">Technical request details</summary>
              <dl className="mt-2 grid gap-1 break-all">
                <div>
                  <dt className="inline font-medium">Request ID: </dt>
                  <dd className="inline">{item.privacyRequestId}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Record version: </dt>
                  <dd className="inline">{item.version}</dd>
                </div>
              </dl>
            </details>
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
      {confirming && confirmation ? (
        <AdminConfirmationDialog
          open
          title={confirmation.title}
          resource={`${typeLabels[confirming.item.requestType]} request`}
          scope="Global customer account"
          consequence={confirmation.consequence}
          initialReason={actionReasons[confirming.item.privacyRequestId] ?? ""}
          maxReasonLength={500}
          confirmLabel={confirmation.label}
          pending={command.busy}
          cancelDisabled={command.uncertain}
          onCancel={() => {
            if (!locked) setConfirming(null);
          }}
          onConfirm={(confirmedReason) => {
            setActionReasons((previous) => ({
              ...previous,
              [confirming.item.privacyRequestId]: confirmedReason,
            }));
            void applyAction(confirming.item, confirming.action, confirmedReason);
          }}
        />
      ) : null}
    </ListPageSection>
  );
}
