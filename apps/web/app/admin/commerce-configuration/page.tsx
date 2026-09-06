"use client";

import { useCallback, useEffect, useState } from "react";
import type { MembershipPriceConfigurationView, RpcResult } from "@freshmarkets/contracts";
import {
  CommerceConfigurationView,
  type MembershipPriceReplacement,
} from "@/components/admin/commerce-configuration-view";
import { CommandBanner } from "@/components/admin/admin-compositions";
import { PageHeader } from "@/components/admin/admin-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminContext } from "../admin-context-provider";

type Notice = { tone: "success" | "conflict" | "error"; title: string; message: string } | null;

export default function CommerceConfigurationPage() {
  const admin = useAdminContext();
  const capabilities = admin.state.phase === "ready" ? admin.state.context.capabilities : [];
  const canRead = capabilities.includes("memberships.read");
  const canManage = capabilities.includes("memberships.manage");
  const [membership, setMembership] = useState<RpcResult<MembershipPriceConfigurationView> | null>(
    null,
  );
  const [scheduled, setScheduled] = useState<MembershipPriceConfigurationView | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [attempt, setAttempt] = useState(0);

  const refresh = useCallback(() => {
    setNotice(null);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (admin.state.phase !== "ready" || !canRead) return;
    let active = true;
    setMembership(null);
    void fetch("/api/admin/commerce-configuration/membership-price")
      .then((response) => response.json() as Promise<RpcResult<MembershipPriceConfigurationView>>)
      .then((result) => active && setMembership(result))
      .catch(() => active && setMembership(networkFailure()));
    return () => {
      active = false;
    };
  }, [admin.state.phase, attempt, canRead]);

  async function replaceMembership(replacement: MembershipPriceReplacement) {
    if (!membership?.ok) return;
    setPending(true);
    setNotice(null);
    let result: RpcResult<MembershipPriceConfigurationView>;
    try {
      const response = await fetch("/api/admin/commerce-configuration/membership-price", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ ...replacement, expectedVersion: membership.value.version }),
      });
      result = (await response.json()) as RpcResult<MembershipPriceConfigurationView>;
    } catch {
      result = networkFailure();
    } finally {
      setPending(false);
    }
    if (result.ok) {
      setScheduled(result.value);
      setAttempt((value) => value + 1);
      setNotice({
        tone: "success",
        title: "Membership price replacement created",
        message: "The effective-dated version and immutable audit evidence were recorded.",
      });
      return;
    }
    const conflict = result.error.code === "STALE_VERSION" || result.error.code === "CONFLICT";
    setNotice({
      tone: conflict ? "conflict" : "error",
      title: conflict ? "Configuration changed" : "Replacement was not accepted",
      message: `${result.error.message} Request reference: ${result.error.requestId}`,
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Membership pricing"
        description="Global effective-dated paid membership pricing. Customer orders have no FreshMarkets fee."
      />
      {notice ? (
        <CommandBanner
          tone={notice.tone}
          title={notice.title}
          message={notice.message}
          action={
            notice.tone === "conflict" ? <Button onClick={refresh}>Refresh</Button> : undefined
          }
        />
      ) : null}
      {admin.state.phase !== "ready" || (canRead && membership === null) ? (
        <Skeleton className="h-96 w-full" />
      ) : null}
      {admin.state.phase === "ready" && !canRead ? (
        <Alert>
          <AlertTitle>Membership pricing is not available to this role</AlertTitle>
          <AlertDescription>memberships.read is required.</AlertDescription>
        </Alert>
      ) : null}
      {membership && !membership.ok ? (
        <Alert variant="destructive">
          <AlertTitle>Membership pricing could not be loaded</AlertTitle>
          <AlertDescription>{membership.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {membership?.ok ? (
        <CommerceConfigurationView
          membership={membership.value}
          scheduledMembership={scheduled}
          canManageMembership={canManage}
          pending={pending}
          onMembershipSubmit={(replacement) => void replaceMembership(replacement)}
        />
      ) : null}
    </div>
  );
}

function networkFailure(): RpcResult<MembershipPriceConfigurationView> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Network error loading membership pricing.",
      requestId: "unavailable",
    },
  };
}
