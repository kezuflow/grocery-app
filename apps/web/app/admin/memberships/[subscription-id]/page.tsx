"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AdminMembershipSummary, RpcResult } from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Skeleton } from "../../../../components/ui/skeleton";
import { ListPageSection, PageHeader, StatusBadge } from "../../../../components/admin/admin-shell";
import { useAdminCommandIntent } from "../../../../components/admin/admin-command-state";

export default function MembershipDetailPage({
  params,
}: {
  params: Promise<{ "subscription-id": string }>;
}) {
  const [id, setId] = useState("");
  const [membership, setMembership] = useState<AdminMembershipSummary | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const commandIntent = useAdminCommandIntent();
  async function load(subscriptionId: string) {
    setState("loading");
    try {
      const payload = (await (
        await fetch(`/api/admin/memberships/${encodeURIComponent(subscriptionId)}`)
      ).json()) as RpcResult<AdminMembershipSummary>;
      if (!payload.ok) {
        setNotice(payload.error.message);
        setState("error");
        return;
      }
      setMembership(payload.value);
      setState("ready");
    } catch {
      setNotice("Network error loading membership.");
      setState("error");
    }
  }
  useEffect(() => {
    void params.then(({ "subscription-id": subscriptionId }) => {
      setId(subscriptionId);
      void load(subscriptionId);
    });
  }, [params]);
  async function cancelMembership() {
    if (!membership || !reason.trim()) {
      setNotice("A reason is required.");
      return;
    }
    const payload = await commandIntent.submit(async (idempotencyKey) => {
      const response = await fetch(`/api/admin/memberships/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          reason: reason.trim(),
          expectedVersion: membership.version,
          timing: "IMMEDIATE",
        }),
      });
      return (await response.json()) as RpcResult<AdminMembershipSummary>;
    });
    setNotice(payload.ok ? "Membership cancellation submitted." : payload.error.message);
    if (payload.ok) {
      setReason("");
      await load(id);
    }
  }
  return (
    <div className="mx-auto max-w-[960px] space-y-6">
      <Link href="/admin/memberships" className="text-sm underline">
        ← Memberships
      </Link>
      {state === "loading" ? (
        <div role="status">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="mt-3 h-40 w-full" />
        </div>
      ) : null}
      {state === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Membership could not be loaded</AlertTitle>
          <AlertDescription>
            {notice}
            <br />
            <Button className="mt-3" size="sm" variant="outline" onClick={() => void load(id)}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state === "ready" && membership ? (
        <>
          <PageHeader
            title={membership.customerEmail}
            description={`Subscription ${membership.subscriptionId}`}
            action={<StatusBadge>{membership.state}</StatusBadge>}
          />
          {notice ? (
            <p role="status" className="border p-3 text-sm">
              {notice}
            </p>
          ) : null}
          <ListPageSection title="Lifecycle">
            <div className="space-y-3 p-4">
              <p className="text-sm">
                Version {membership.version} · period ends{" "}
                {membership.currentPeriodEndsAt?.slice(0, 10) ?? "—"}
              </p>
              <Input
                aria-label="Membership action reason"
                placeholder="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <div className="flex gap-2">
                {!["CANCELED", "EXPIRED"].includes(membership.state) ? (
                  <Button variant="destructive" onClick={() => void cancelMembership()}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
          </ListPageSection>
        </>
      ) : null}
    </div>
  );
}
