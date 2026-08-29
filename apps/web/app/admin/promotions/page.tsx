"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AdminPromotionPage, RpcResult } from "@freshmarkets/contracts";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { PageHeader, ListPageSection, StatusBadge } from "../../../components/admin/admin-shell";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready" };

export default function PromotionsPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [page, setPage] = useState<AdminPromotionPage | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [discount, setDiscount] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const commandKeys = useRef(new Map<string, string>());

  const load = useCallback(() => {
    setState({ phase: "loading" });
    void (async () => {
      try {
        const response = await fetch("/api/admin/promotions?limit=50");
        const payload = (await response.json()) as RpcResult<AdminPromotionPage>;
        if (!payload.ok) {
          setState({
            phase: "error",
            message:
              payload.error.code === "FORBIDDEN"
                ? "Promotion administration requires the promotions.read capability with a global scope."
                : payload.error.message,
            requestId: payload.error.requestId,
          });
          return;
        }
        setPage(payload.value);
        setState({ phase: "ready" });
      } catch {
        setState({ phase: "error", message: "Network error loading promotions.", requestId: null });
      }
    })();
  }, []);

  useEffect(() => load(), [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (code.trim() === "" || name.trim() === "" || Number.isNaN(Number(discount))) {
      setNotice("A code, name, and numeric discount are required.");
      return;
    }
    const intent = JSON.stringify({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      discountMinor: Math.round(Number(discount) * 100),
    });
    const idempotencyKey = commandKeys.current.get(intent) ?? crypto.randomUUID();
    commandKeys.current.set(intent, idempotencyKey);
    const response = await fetch("/api/admin/promotions", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        benefitType: "ORDER_FIXED_DISCOUNT",
        discountMinor: Math.round(Number(discount) * 100),
        minimumMinor: 0,
        startsAt: new Date().toISOString(),
      }),
    });
    const payload = (await response.json()) as RpcResult<unknown> & {
      error?: { message?: string };
    };
    setNotice(
      payload.ok ? "Promotion created as DRAFT." : (payload.error?.message ?? "Creation failed."),
    );
    if (payload.ok) {
      commandKeys.current.delete(intent);
      setCode("");
      setName("");
      setDiscount("");
      load();
    }
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Promotions"
        description="Order-benefit definitions over the closed vocabulary. Membership trials stay with their own authority."
      />

      {state.phase === "loading" ? (
        <div className="space-y-3" role="status" aria-label="Loading promotions">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}

      {state.phase === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Promotions could not be loaded</AlertTitle>
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
      ) : null}

      {state.phase === "ready" ? (
        <>
          {notice ? (
            <p
              role="status"
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-3 text-sm"
            >
              {notice}
            </p>
          ) : null}

          <ListPageSection
            title="Create a promotion"
            description="Created as DRAFT; activate when ready."
          >
            <form className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center" onSubmit={create}>
              <Input
                aria-label="Promotion code"
                placeholder="CODE"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="sm:w-44"
              />
              <Input
                aria-label="Promotion name"
                placeholder="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="sm:w-56"
              />
              <Input
                aria-label="Fixed discount in pesos"
                placeholder="discount ₱"
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
                className="sm:w-32"
              />
              <Button type="submit" size="sm">
                Create draft
              </Button>
            </form>
          </ListPageSection>

          <ListPageSection title="Definitions">
            {page === null || page.items.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
                No promotions defined yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Benefit</TableHead>
                    <TableHead>
                      <span className="sr-only">Detail link</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.items.map((promotion) => (
                    <TableRow key={promotion.promotionId}>
                      <TableCell className="font-mono text-xs">{promotion.code}</TableCell>
                      <TableCell className="font-medium">{promotion.name}</TableCell>
                      <TableCell>
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
                      </TableCell>
                      <TableCell className="text-xs text-[var(--fm-text-muted)]">
                        {promotion.benefitType === "ORDER_PERCENT_DISCOUNT"
                          ? `${promotion.percent}% off`
                          : `₱${((promotion.discountMinor ?? 0) / 100).toFixed(2)} off`}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/admin/promotions/${promotion.promotionId}`}
                          className="text-xs font-medium text-[var(--fm-info)] underline"
                        >
                          Manage
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ListPageSection>
        </>
      ) : null}
    </div>
  );
}
