"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, use } from "react";
import type {
  AdminPromotionDetail,
  AdminPromotionGrantView,
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
  adminPromotionPreviewViewSchema,
} from "@freshmarkets/validation";
import { CustomerPicker, type CustomerChoice } from "@/components/admin/customer-picker";
import { PromotionAudienceEditor } from "@/components/admin/promotion-audience-editor";
import { PromotionDefinitionForm } from "@/components/admin/promotion-definition-form";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Skeleton } from "../../../../components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { PageHeader, ListPageSection, StatusBadge } from "../../../../components/admin/admin-shell";
import { AdminPageState } from "../../../../components/admin/admin-page-state";
import { notifyCommandSuccess } from "@/components/admin/admin-feedback";
import { useAdminRouteGuard } from "../../../../components/admin/use-admin-route-guard";
import { useAdminContext, useAdminScopeGuard } from "../../admin-context-provider";

type HistoryState<T> =
  | { phase: "ready"; page: T }
  | { phase: "error"; message: string; requestId: string | null };

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; code: string; message: string; requestId: string | null }
  | {
      phase: "ready";
      promotion: AdminPromotionDetail;
      grants: HistoryState<AdminPromotionGrantPage>;
      redemptions: HistoryState<AdminPromotionRedemptionPage>;
    };

const BASE = "/api/admin/promotions";

function formatPromotionDate(value: string): string {
  return `${new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(value))} PHT`;
}

export default function PromotionDetailPage({
  params,
}: {
  params: Promise<{ "promotion-id": string }>;
}) {
  const { "promotion-id": promotionId } = use(params);
  const admin = useAdminContext();

  if (admin.state.phase !== "ready") {
    return <AdminPageState state="loading" title="Loading promotion access" />;
  }

  const canRead =
    admin.state.selectedScope?.kind === "GLOBAL" &&
    admin.state.context.capabilities.includes("promotions.read");
  if (!canRead) {
    return (
      <section className="space-y-5" aria-labelledby="admin-page-title">
        <PageHeader title="Promotion unavailable" />
        <AdminPageState
          state="error"
          title="Promotion access denied"
          message="Promotion details require the promotions.read capability with a Global scope."
        />
      </section>
    );
  }

  const scopeKey = JSON.stringify(admin.state.selectedScope);
  return (
    <PromotionDetailWorkspace
      key={`${scopeKey}:${promotionId}`}
      promotionId={promotionId}
      canManage={admin.state.context.capabilities.includes("promotions.manage")}
    />
  );
}

function PromotionDetailWorkspace({
  promotionId,
  canManage,
}: {
  promotionId: string;
  canManage: boolean;
}) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [deliverySubtotal, setDeliverySubtotal] = useState("");
  const [previewSubtotal, setPreviewSubtotal] = useState("");
  const [previewResult, setPreviewResult] = useState<AdminPromotionPreviewView | null>(null);
  const [grantCustomer, setGrantCustomer] = useState<CustomerChoice | null>(null);
  const [previewCustomer, setPreviewCustomer] = useState<CustomerChoice | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const command = useCatalogCommand(
    z.union([adminPromotionSummarySchema, adminPromotionGrantViewSchema]),
  );
  const frozen = command.pending || command.uncertain;
  const loadGeneration = useRef(0);
  useAdminScopeGuard(false, canManage && frozen);
  useAdminRouteGuard(false, canManage && frozen);

  const load = useCallback(
    (preserveConfirmed = false) => {
      const generation = ++loadGeneration.current;
      if (!preserveConfirmed) {
        setPreviewResult(null);
        setState({ phase: "loading" });
      }
      void (async () => {
        try {
          const promotionResponse = await fetch(`${BASE}/${encodeURIComponent(promotionId)}`);
          const promotionPayload = catalogResultSchema(adminPromotionSummarySchema).parse(
            await promotionResponse.json(),
          );
          if (generation !== loadGeneration.current) return;
          if (!promotionPayload.ok) {
            if (preserveConfirmed) {
              setNotice(
                "The change is confirmed, but the latest promotion could not be refreshed.",
              );
              return;
            }
            setState({
              phase: "error",
              code: promotionPayload.error.code,
              message: promotionPayload.error.message,
              requestId: promotionPayload.error.requestId,
            });
            return;
          }
          const [grantsResult, redemptionsResult] = await Promise.allSettled([
            fetch(`${BASE}/${encodeURIComponent(promotionId)}/grants`).then(
              async (response) => (await response.json()) as RpcResult<AdminPromotionGrantPage>,
            ),
            fetch(`${BASE}/${encodeURIComponent(promotionId)}/redemptions`).then(
              async (response) =>
                (await response.json()) as RpcResult<AdminPromotionRedemptionPage>,
            ),
          ]);
          if (generation !== loadGeneration.current) return;
          const grants: HistoryState<AdminPromotionGrantPage> =
            grantsResult.status === "fulfilled"
              ? grantsResult.value.ok
                ? { phase: "ready", page: grantsResult.value.value }
                : {
                    phase: "error",
                    message: grantsResult.value.error.message,
                    requestId: grantsResult.value.error.requestId,
                  }
              : {
                  phase: "error",
                  message: "Grant history could not be loaded. Check the connection and retry.",
                  requestId: null,
                };
          const redemptions: HistoryState<AdminPromotionRedemptionPage> =
            redemptionsResult.status === "fulfilled"
              ? redemptionsResult.value.ok
                ? { phase: "ready", page: redemptionsResult.value.value }
                : {
                    phase: "error",
                    message: redemptionsResult.value.error.message,
                    requestId: redemptionsResult.value.error.requestId,
                  }
              : {
                  phase: "error",
                  message:
                    "Redemption history could not be loaded. Check the connection and retry.",
                  requestId: null,
                };
          if (preserveConfirmed && (grants.phase === "error" || redemptions.phase === "error")) {
            setNotice(
              "The change is confirmed, but some promotion history could not be refreshed.",
            );
          }
          setState((current) => ({
            phase: "ready",
            promotion: promotionPayload.value,
            grants:
              preserveConfirmed && grants.phase === "error" && current.phase === "ready"
                ? current.grants
                : grants,
            redemptions:
              preserveConfirmed && redemptions.phase === "error" && current.phase === "ready"
                ? current.redemptions
                : redemptions,
          }));
        } catch {
          if (generation !== loadGeneration.current) return;
          if (preserveConfirmed) {
            setNotice("The change is confirmed, but the latest promotion could not be refreshed.");
            return;
          }
          setState({
            phase: "error",
            code: "NETWORK_ERROR",
            message: "Network error loading the promotion.",
            requestId: null,
          });
        }
      })();
    },
    [promotionId],
  );

  function applyConfirmed(value: AdminPromotionDetail | AdminPromotionGrantView): void {
    setState((current) => {
      if (current.phase !== "ready") return current;
      if ("code" in value) return { ...current, promotion: value };
      if (current.grants.phase !== "ready") return current;
      if (current.grants.page.items.some((grant) => grant.grantId === value.grantId))
        return current;
      return {
        ...current,
        grants: {
          phase: "ready",
          page: {
            ...current.grants.page,
            items: [value, ...current.grants.page.items],
          },
        },
      };
    });
  }

  useEffect(() => {
    load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]);

  async function run(url: string, method: "POST" | "PATCH", body: unknown, successTitle: string) {
    if (!canManage) return false;
    try {
      const payload = await command.submit(url, body, method).catch(() => command.retry());
      if (!payload) return false;
      setNotice(payload.ok ? "Applied." : payload.error.message);
      if (payload.ok) {
        notifyCommandSuccess(successTitle);
        setGrantCustomer(null);
        applyConfirmed(payload.value);
        load(true);
      }
      return payload.ok;
    } catch {
      setNotice("The change could not be confirmed. Try again to check the same change.");
      return false;
    }
  }

  async function loadHistory(kind: "grants" | "redemptions", cursor: string) {
    try {
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
        if (kind === "grants" && current.grants.phase === "ready") {
          const next = payload.value as AdminPromotionGrantPage;
          return {
            ...current,
            grants: {
              phase: "ready",
              page: {
                items: [...current.grants.page.items, ...next.items],
                nextCursor: next.nextCursor,
              },
            },
          };
        }
        if (kind === "redemptions" && current.redemptions.phase === "ready") {
          const next = payload.value as AdminPromotionRedemptionPage;
          return {
            ...current,
            redemptions: {
              phase: "ready",
              page: {
                items: [...current.redemptions.page.items, ...next.items],
                nextCursor: next.nextCursor,
              },
            },
          };
        }
        return current;
      });
    } catch {
      setNotice(`More ${kind} could not be loaded. Check the connection and try again.`);
    }
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
    const title =
      state.code === "NOT_FOUND"
        ? "Promotion not found"
        : state.code === "FORBIDDEN"
          ? "Promotion access denied"
          : "The promotion could not be loaded";
    return (
      <Alert variant="destructive">
        <AlertTitle>{title}</AlertTitle>
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
    <div className="w-full space-y-6">
      <Link
        href="/admin/promotions"
        className="inline-flex text-sm font-medium text-[var(--fm-text-muted)] hover:text-[var(--fm-text)]"
      >
        Back to Promotion Codes
      </Link>
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
          className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-3 text-sm"
        >
          {notice}
        </p>
      ) : null}

      {canManage && command.uncertain ? (
        <Button
          disabled={command.pending}
          onClick={async () => {
            try {
              const result = await command.retry();
              if (!result) return;
              setNotice(result.ok ? "Applied." : result.error.message);
              if (result.ok) {
                applyConfirmed(result.value);
                load(true);
              }
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
        description={
          canManage
            ? "Draft details can be edited before activation."
            : "Recorded campaign definition and limits."
        }
      >
        {canManage && promotion.status === "DRAFT" ? (
          <PromotionDefinitionForm
            key={promotion.version}
            promotion={promotion}
            disabled={frozen}
            onSave={(body) =>
              run(`${BASE}/${encodeURIComponent(promotionId)}`, "PATCH", body, "Promotion saved")
            }
          />
        ) : (
          <div className="space-y-2 p-4 text-sm">
            <p>{promotion.description || "No description"}</p>
            <p>
              {promotion.benefitType.endsWith("FIXED_DISCOUNT")
                ? `Discount: PHP ${((promotion.discountMinor ?? 0) / 100).toFixed(2)}`
                : promotion.benefitType === "DELIVERY_FEE_WAIVER"
                  ? "Free delivery"
                  : `Discount: ${promotion.percent}%`}
              {promotion.productTargets?.length ? " per selected selling unit" : ""}
            </p>
            {promotion.productTargets?.map((target) => (
              <p key={`${target.skuId}:${target.locationId}`}>
                {target.productName ?? "Selected product"} · {target.skuName ?? "Selling option"} ·{" "}
                {target.locationName ?? "Selected location"}:{" "}
                {target.quantityLimit === null
                  ? "No sale quantity limit"
                  : `${target.remainingQuantity} of ${target.quantityLimit} sale units remaining (Instant only)`}
              </p>
            ))}
            <p>Minimum purchase: PHP {(promotion.minimumMinor / 100).toFixed(2)}</p>
            <p>
              Maximum discount:{" "}
              {promotion.maximumDiscountMinor == null
                ? "No cap"
                : `PHP ${(promotion.maximumDiscountMinor / 100).toFixed(2)}`}
            </p>
            <p>Total redemption limit: {promotion.globalUsageLimit ?? "No limit"}</p>
            <p>Customer redemption limit: {promotion.perCustomerUsageLimit ?? "No limit"}</p>
            <p>
              {promotion.automatic
                ? "Applied automatically when eligible"
                : "Applied by code or customer grant"}
            </p>
            <p>Starts: {formatPromotionDate(promotion.startsAt)}</p>
            <p>Ends: {promotion.endsAt ? formatPromotionDate(promotion.endsAt) : "No end date"}</p>
          </div>
        )}
      </ListPageSection>
      <p className="text-sm">
        Storefront images are managed in{" "}
        <Link href="/admin/banners" className="underline">
          Banners
        </Link>
        .
      </p>
      <ListPageSection
        title="Audience"
        description={
          canManage
            ? "Choose the customers who can qualify for this campaign."
            : "Customers who can qualify for this campaign."
        }
      >
        <PromotionAudienceEditor
          promotionId={promotionId}
          status={promotion.status}
          version={promotion.version}
          canManage={canManage}
          onSaved={(version) => {
            setNotice("Audience saved.");
            setState((current) =>
              current.phase === "ready"
                ? { ...current, promotion: { ...current.promotion, version } }
                : current,
            );
            load(true);
          }}
        />
      </ListPageSection>
      {canManage ? (
        <ListPageSection title="Lifecycle" description="Status changes are audited automatically.">
          <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
            <div className="flex flex-wrap gap-2">
              {promotion.status === "DRAFT" || promotion.status === "INACTIVE" ? (
                <Button
                  size="sm"
                  disabled={frozen}
                  onClick={() => {
                    void run(
                      `${BASE}/${encodeURIComponent(promotionId)}/status`,
                      "POST",
                      {
                        action: "ACTIVATE",
                        expectedVersion: promotion.version,
                      },
                      "Promotion activated",
                    );
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
                    void run(
                      `${BASE}/${encodeURIComponent(promotionId)}/status`,
                      "POST",
                      {
                        action: "DEACTIVATE",
                        expectedVersion: promotion.version,
                      },
                      "Promotion deactivated",
                    );
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
                    void run(
                      `${BASE}/${encodeURIComponent(promotionId)}/status`,
                      "POST",
                      {
                        action: "ARCHIVE",
                        expectedVersion: promotion.version,
                      },
                      "Promotion archived",
                    );
                  }}
                >
                  Archive
                </Button>
              ) : null}
            </div>
          </div>
        </ListPageSection>
      ) : null}

      <ListPageSection
        title="Preview"
        description={
          promotion.productTargets?.length
            ? "This sale depends on the selected items, quantities and location. Checkout confirms the discount; a subtotal alone cannot preview it."
            : "Select a customer to check eligibility and current usage. Without a customer, this is an amount estimate. Checkout confirms the final result."
        }
      >
        {!promotion.productTargets?.length ? (
          <div className="space-y-3 p-4">
            <CustomerPicker
              label="Preview customer"
              value={previewCustomer}
              disabled={previewPending}
              onChange={(value) => {
                setPreviewCustomer(value);
                setPreviewResult(null);
              }}
            />
            <Input
              aria-label="Subtotal in pesos"
              placeholder="subtotal ₱"
              value={previewSubtotal}
              onChange={(event) => {
                setPreviewSubtotal(event.target.value);
                setPreviewResult(null);
              }}
              disabled={previewPending}
              className="sm:w-44"
            />
            {promotion.benefitType.startsWith("DELIVERY") ? (
              <Input
                aria-label="Delivery fee in pesos"
                placeholder="delivery fee PHP"
                value={deliverySubtotal}
                onChange={(event) => {
                  setDeliverySubtotal(event.target.value);
                  setPreviewResult(null);
                }}
                disabled={previewPending}
              />
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={previewPending}
              onClick={() => {
                const pesos = Number(previewSubtotal);
                if (
                  !/^\d+(\.\d{1,2})?$/.test(previewSubtotal.trim()) ||
                  (promotion.benefitType.startsWith("DELIVERY") &&
                    !/^\d+(\.\d{1,2})?$/.test(deliverySubtotal.trim()))
                ) {
                  setNotice(
                    "Enter the merchandise subtotal and delivery fee where required, with at most two decimal places.",
                  );
                  return;
                }
                setPreviewPending(true);
                setPreviewResult(null);
                void (async () => {
                  try {
                    const response = await fetch(
                      `${BASE}/${encodeURIComponent(promotionId)}/preview`,
                      {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          subtotalMinor: Math.round(pesos * 100),
                          ...(previewCustomer ? { customerId: previewCustomer.customerId } : {}),
                          ...(promotion.benefitType.startsWith("DELIVERY")
                            ? { deliverySubtotalMinor: Math.round(Number(deliverySubtotal) * 100) }
                            : {}),
                        }),
                      },
                    );
                    const payload = catalogResultSchema(adminPromotionPreviewViewSchema).parse(
                      await response.json(),
                    );
                    setPreviewResult(payload.ok ? payload.value : null);
                    setNotice(payload.ok ? null : payload.error.message);
                  } catch {
                    setNotice("Preview could not be loaded. Try again.");
                  } finally {
                    setPreviewPending(false);
                  }
                })();
              }}
            >
              {previewPending ? "Checking..." : "Preview"}
            </Button>
            {previewResult ? (
              <span className="text-sm" role="status">
                {previewResult.eligible
                  ? `${previewResult.eligibilityChecked ? "Eligible discount" : "Estimated discount"} ₱${((previewResult.discountMinor ?? 0) / 100).toFixed(2)}`
                  : previewResult.reasonCode === "CUSTOMER_UNAVAILABLE"
                    ? "Customer is unavailable for new commerce."
                    : previewResult.reasonCode === "CUSTOMER_INELIGIBLE"
                      ? "Customer is not eligible under the campaign rules or current usage limits."
                      : "Campaign is unavailable for these totals or dates."}
              </span>
            ) : null}
          </div>
        ) : null}
      </ListPageSection>

      <ListPageSection
        title="Grants"
        description={
          canManage
            ? "Offer this campaign to a customer. Eligibility and redemption limits still apply at checkout."
            : "Recorded customer grants. Eligibility and redemption limits still apply at checkout."
        }
      >
        {canManage && promotion.status === "ACTIVE" ? (
          <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
            <CustomerPicker
              label="Grant customer"
              value={grantCustomer}
              onChange={setGrantCustomer}
              disabled={frozen}
            />
            <Button
              size="sm"
              disabled={frozen}
              onClick={() => {
                if (!grantCustomer) {
                  setNotice("Choose a customer first.");
                  return;
                }
                void run(
                  `${BASE}/${encodeURIComponent(promotionId)}/grants`,
                  "POST",
                  {
                    customerId: grantCustomer.customerId,
                    maxRedemptions: 1,
                  },
                  "Promotion granted",
                );
              }}
            >
              Grant to customer
            </Button>
          </div>
        ) : null}
        {grants.phase === "error" ? (
          <Alert variant="destructive" className="m-4">
            <AlertTitle>Grant history unavailable</AlertTitle>
            <AlertDescription>
              {grants.message}
              {grants.requestId ? (
                <span className="mt-1 block font-mono text-xs">
                  Request reference: {grants.requestId}
                </span>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : grants.page.items.length === 0 ? (
          <p className="p-5 pt-0 text-sm text-[var(--fm-text-muted)]">No grants yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--fm-border)] border-t border-[var(--fm-border)]">
            {grants.page.items.map((grant) => (
              <li
                key={grant.grantId}
                className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
              >
                <a
                  className="text-sm underline"
                  href={`/admin/customers/${encodeURIComponent(grant.customerId)}`}
                >
                  View customer
                </a>
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
        {grants.phase === "ready" && grants.page.nextCursor ? (
          <div className="border-t border-[var(--fm-border)] p-4">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadHistory("grants", grants.page.nextCursor!)}
            >
              Load more grants
            </Button>
          </div>
        ) : null}
      </ListPageSection>

      <ListPageSection title="Redemptions" description="Recorded at checkout; read-only here.">
        {redemptions.phase === "error" ? (
          <Alert variant="destructive" className="m-4">
            <AlertTitle>Redemption history unavailable</AlertTitle>
            <AlertDescription>
              {redemptions.message}
              {redemptions.requestId ? (
                <span className="mt-1 block font-mono text-xs">
                  Request reference: {redemptions.requestId}
                </span>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : redemptions.page.items.length === 0 ? (
          <p className="p-5 text-sm text-[var(--fm-text-muted)]">No redemptions recorded.</p>
        ) : (
          <ul className="divide-y divide-[var(--fm-border)]">
            {redemptions.page.items.map((redemption) => (
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
        {redemptions.phase === "ready" && redemptions.page.nextCursor ? (
          <div className="border-t border-[var(--fm-border)] p-4">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadHistory("redemptions", redemptions.page.nextCursor!)}
            >
              Load more redemptions
            </Button>
          </div>
        ) : null}
      </ListPageSection>
    </div>
  );
}
