"use client";
import { useCallback, useEffect, useState, use } from "react";
import type {
  AdminPromotionDetail,
  AdminPromotionGrantPage,
  AdminPromotionPreviewView,
  AdminPromotionRedemptionPage,
  RpcResult,
} from "@freshmarkets/contracts";
import { useCatalogCommand, catalogResultSchema } from "@/components/admin/catalog-command-state";
import {
  z,
  adminPromotionSummarySchema,
  adminPromotionGrantViewSchema,
} from "@freshmarkets/validation";
import { PromotionDefinitionForm } from "@/components/admin/promotion-definition-form";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Skeleton } from "../../../../components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { PageHeader, ListPageSection, StatusBadge } from "../../../../components/admin/admin-shell";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | {
      phase: "ready";
      promotion: AdminPromotionDetail;
      grants: AdminPromotionGrantPage;
      redemptions: AdminPromotionRedemptionPage;
    };

const BASE = "/api/admin/promotions";

export default function PromotionDetailPage({
  params,
}: {
  params: Promise<{ "promotion-id": string }>;
}) {
  const { "promotion-id": promotionId } = use(params);
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [reason, setReason] = useState("");
  const [previewSubtotal, setPreviewSubtotal] = useState("");
  const [previewResult, setPreviewResult] = useState<AdminPromotionPreviewView | null>(null);
  const [grantCustomerId, setGrantCustomerId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const command = useCatalogCommand(
    z.union([adminPromotionSummarySchema, adminPromotionGrantViewSchema]),
  );
  const frozen = command.pending || command.uncertain;

  const load = useCallback(() => {
    setState({ phase: "loading" });
    void (async () => {
      try {
        const [promotionResponse, grantsResponse, redemptionsResponse] = await Promise.all([
          fetch(`${BASE}/${encodeURIComponent(promotionId)}`),
          fetch(`${BASE}/${encodeURIComponent(promotionId)}/grants`),
          fetch(`${BASE}/${encodeURIComponent(promotionId)}/redemptions`),
        ]);
        const promotionPayload = catalogResultSchema(adminPromotionSummarySchema).parse(
          await promotionResponse.json(),
        );
        if (!promotionPayload.ok) {
          setState({
            phase: "error",
            message: promotionPayload.error.message,
            requestId: promotionPayload.error.requestId,
          });
          return;
        }
        const grantsPayload = (await grantsResponse.json()) as RpcResult<AdminPromotionGrantPage>;
        const redemptionsPayload =
          (await redemptionsResponse.json()) as RpcResult<AdminPromotionRedemptionPage>;
        setState({
          phase: "ready",
          promotion: promotionPayload.value,
          grants: grantsPayload.ok ? grantsPayload.value : { items: [], nextCursor: null },
          redemptions: redemptionsPayload.ok
            ? redemptionsPayload.value
            : { items: [], nextCursor: null },
        });
      } catch {
        setState({
          phase: "error",
          message: "Network error loading the promotion.",
          requestId: null,
        });
      }
    })();
  }, [promotionId]);

  useEffect(() => load(), [load]);

  async function run(url: string, method: "POST" | "PATCH", body: unknown) {
    try {
      const payload = await command.submit(url, body, method).catch(() => command.retry());
      if (!payload) return false;
      setNotice(payload.ok ? "Applied." : payload.error.message);
      if (payload.ok) {
        setGrantCustomerId("");
        load();
      }
      return payload.ok;
    } catch {
      setNotice("The change could not be confirmed. Try again to check the same change.");
      return false;
    }
  }

  async function loadHistory(kind: "grants" | "redemptions", cursor: string) {
    const response = await fetch(
      `${BASE}/${encodeURIComponent(promotionId)}/${kind}?cursor=${encodeURIComponent(cursor)}`,
    );
    const payload = (await response.json()) as RpcResult<
      AdminPromotionGrantPage | AdminPromotionRedemptionPage
    >;
    if (!payload.ok) {
      setNotice(payload.error.message);
      return;
    }
    setState((current) => {
      if (current.phase !== "ready") return current;
      if (kind === "grants") {
        const next = payload.value as AdminPromotionGrantPage;
        return {
          ...current,
          grants: { items: [...current.grants.items, ...next.items], nextCursor: next.nextCursor },
        };
      }
      const next = payload.value as AdminPromotionRedemptionPage;
      return {
        ...current,
        redemptions: {
          items: [...current.redemptions.items, ...next.items],
          nextCursor: next.nextCursor,
        },
      };
    });
  }

  if (state.phase === "loading") {
    return (
      <div className="space-y-3" role="status" aria-label="Loading promotion">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>The promotion could not be loaded</AlertTitle>
        <AlertDescription>
          {state.message}
          {state.requestId ? (
            <>
              <br />
              <span className="font-mono text-xs">Request reference: {state.requestId}</span>
            </>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  const { promotion, grants, redemptions } = state;

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title={promotion.name}
        description={promotion.code}
        action={
          <StatusBadge
            tone={
              promotion.status === "ACTIVE"
                ? "success"
                : promotion.status === "ARCHIVED"
                  ? "neutral"
                  : "info"
            }
          >
            {promotion.status}
          </StatusBadge>
        }
      />

      {notice ? (
        <p
          role="status"
          className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-3 text-sm"
        >
          {notice}
        </p>
      ) : null}

      {command.uncertain ? (
        <Button
          disabled={command.pending}
          onClick={async () => {
            try {
              const result = await command.retry();
              if (!result) return;
              setNotice(result.ok ? "Applied." : result.error.message);
              if (result.ok) load();
            } catch {
              setNotice("The change is still unconfirmed. Try again.");
            }
          }}
        >
          Try again
        </Button>
      ) : null}
      <ListPageSection
        title="Campaign details"
        description="Draft details can be edited before activation."
      >
        {promotion.status === "DRAFT" ? (
          <PromotionDefinitionForm
            promotion={promotion}
            disabled={frozen}
            onSave={(body) => run(`${BASE}/${encodeURIComponent(promotionId)}`, "PATCH", body)}
          />
        ) : (
          <div className="space-y-2 p-4 text-sm">
            <p>{promotion.description || "No description"}</p>
            <p>
              {promotion.benefitType === "ORDER_FIXED_DISCOUNT"
                ? `Merchandise discount: PHP ${((promotion.discountMinor ?? 0) / 100).toFixed(2)}`
                : `Merchandise discount: ${promotion.percent}%`}
            </p>
            <p>Minimum purchase: PHP {(promotion.minimumMinor / 100).toFixed(2)}</p>
            <p>
              Starts: {promotion.startsAt}{" "}
              {promotion.endsAt ? `Ends: ${promotion.endsAt}` : "No end date"}
            </p>
          </div>
        )}
      </ListPageSection>
      <ListPageSection
        title="Lifecycle"
        description="Every action requires a reason and is audited."
      >
        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
          <Input
            aria-label="Reason"
            disabled={frozen}
            placeholder="reason (required)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="sm:w-72"
          />
          <div className="flex flex-wrap gap-2">
            {promotion.status === "DRAFT" || promotion.status === "INACTIVE" ? (
              <Button
                size="sm"
                disabled={frozen}
                onClick={() => {
                  if (reason.trim() === "") return setNotice("A reason is required.");
                  void run(`${BASE}/${encodeURIComponent(promotionId)}/status`, "POST", {
                    action: "ACTIVATE",
                    reason: reason.trim(),
                    expectedVersion: promotion.version,
                  });
                }}
              >
                Activate
              </Button>
            ) : null}
            {promotion.status === "ACTIVE" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={frozen}
                onClick={() => {
                  if (reason.trim() === "") return setNotice("A reason is required.");
                  void run(`${BASE}/${encodeURIComponent(promotionId)}/status`, "POST", {
                    action: "DEACTIVATE",
                    reason: reason.trim(),
                    expectedVersion: promotion.version,
                  });
                }}
              >
                Deactivate
              </Button>
            ) : null}
            {promotion.status === "DRAFT" || promotion.status === "INACTIVE" ? (
              <Button
                size="sm"
                variant="destructive"
                disabled={frozen}
                onClick={() => {
                  if (reason.trim() === "") return setNotice("A reason is required.");
                  void run(`${BASE}/${encodeURIComponent(promotionId)}/status`, "POST", {
                    action: "ARCHIVE",
                    reason: reason.trim(),
                    expectedVersion: promotion.version,
                  });
                }}
              >
                Archive
              </Button>
            ) : null}
          </div>
        </div>
      </ListPageSection>

      <ListPageSection
        title="Preview"
        description="Read-only evaluation over a merchandise subtotal."
      >
        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
          <Input
            aria-label="Subtotal in pesos"
            placeholder="subtotal ₱"
            value={previewSubtotal}
            onChange={(event) => setPreviewSubtotal(event.target.value)}
            className="sm:w-44"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const pesos = Number(previewSubtotal);
              if (Number.isNaN(pesos)) {
                setNotice("Enter a numeric subtotal.");
                return;
              }
              void (async () => {
                const response = await fetch(`${BASE}/${encodeURIComponent(promotionId)}/preview`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ subtotalMinor: Math.round(pesos * 100) }),
                });
                const payload = (await response.json()) as RpcResult<AdminPromotionPreviewView>;
                setPreviewResult(payload.ok ? payload.value : null);
              })();
            }}
          >
            Preview
          </Button>
          {previewResult ? (
            <span className="text-sm" role="status">
              {previewResult.eligible
                ? `Eligible — discount ₱${((previewResult.discountMinor ?? 0) / 100).toFixed(2)}`
                : `Not eligible (${previewResult.reasonCode})`}
            </span>
          ) : null}
        </div>
      </ListPageSection>

      <ListPageSection
        title="Grants"
        description="Targeted grants through the canonical grant table. Redemption happens at checkout."
      >
        {promotion.status === "ACTIVE" ? (
          <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
            <Input
              aria-label="Customer ID"
              disabled={frozen}
              placeholder="customer ID"
              value={grantCustomerId}
              onChange={(event) => setGrantCustomerId(event.target.value)}
              className="sm:w-72"
            />
            <Button
              size="sm"
              disabled={frozen}
              onClick={() => {
                if (grantCustomerId.trim() === "") {
                  setNotice("A customer ID is required.");
                  return;
                }
                void run(`${BASE}/${encodeURIComponent(promotionId)}/grants`, "POST", {
                  customerId: grantCustomerId.trim(),
                  maxRedemptions: 1,
                });
              }}
            >
              Grant to customer
            </Button>
          </div>
        ) : null}
        {grants.items.length === 0 ? (
          <p className="p-5 pt-0 text-sm text-[var(--fm-text-muted)]">No grants yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--fm-border)] border-t border-[var(--fm-border)]">
            {grants.items.map((grant) => (
              <li
                key={grant.grantId}
                className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
              >
                <span className="font-mono text-xs">{grant.customerId}</span>
                <StatusBadge tone={grant.status === "ACTIVE" ? "success" : "neutral"}>
                  {grant.status}
                </StatusBadge>
                <span className="text-xs text-[var(--fm-text-muted)]">
                  max {grant.maxRedemptions} redemption{grant.maxRedemptions === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {grants.nextCursor ? (
          <div className="border-t border-[var(--fm-border)] p-4">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadHistory("grants", grants.nextCursor!)}
            >
              Load more grants
            </Button>
          </div>
        ) : null}
      </ListPageSection>

      <ListPageSection title="Redemptions" description="Recorded at checkout; read-only here.">
        {redemptions.items.length === 0 ? (
          <p className="p-5 text-sm text-[var(--fm-text-muted)]">No redemptions recorded.</p>
        ) : (
          <ul className="divide-y divide-[var(--fm-border)]">
            {redemptions.items.map((redemption) => (
              <li
                key={redemption.redemptionId}
                className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
              >
                <span className="font-mono text-xs">{redemption.customerId}</span>
                <span className="text-xs text-[var(--fm-text-muted)]">
                  {redemption.redeemedAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {redemptions.nextCursor ? (
          <div className="border-t border-[var(--fm-border)] p-4">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadHistory("redemptions", redemptions.nextCursor!)}
            >
              Load more redemptions
            </Button>
          </div>
        ) : null}
      </ListPageSection>
    </div>
  );
}
