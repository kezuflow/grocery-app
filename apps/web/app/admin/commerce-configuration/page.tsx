"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type {
  MembershipPriceConfigurationView,
  RpcResult,
  ServiceFeeConfigurationView,
} from "@freshmarkets/contracts";
import {
  CommerceConfigurationView,
  type MembershipPriceReplacement,
  type ServiceFeeReplacement,
} from "@/components/admin/commerce-configuration-view";
import { CommandBanner } from "@/components/admin/admin-compositions";
import { PageHeader } from "@/components/admin/admin-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminContext } from "../admin-context-provider";

type Notice = {
  tone: "success" | "conflict" | "error";
  title: string;
  message: string;
} | null;

export default function CommerceConfigurationPage() {
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") === "service-fee" ? "service-fee" : "membership";
  const admin = useAdminContext();
  const capabilities = admin.state.phase === "ready" ? admin.state.context.capabilities : [];
  const canReadMembership = capabilities.includes("memberships.read");
  const canManageMembership = capabilities.includes("memberships.manage");
  const canReadServiceFee = capabilities.includes("payments.read");
  const canManageServiceFee = capabilities.includes("payments.manage");
  const [membership, setMembership] = useState<RpcResult<MembershipPriceConfigurationView> | null>(
    null,
  );
  const [serviceFee, setServiceFee] = useState<RpcResult<ServiceFeeConfigurationView> | null>(null);
  const [scheduledMembership, setScheduledMembership] =
    useState<MembershipPriceConfigurationView | null>(null);
  const [scheduledServiceFee, setScheduledServiceFee] =
    useState<ServiceFeeConfigurationView | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [attempt, setAttempt] = useState(0);

  const refresh = useCallback(() => {
    setNotice(null);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (admin.state.phase !== "ready") return;
    let active = true;
    if (canReadMembership) {
      setMembership(null);
      void fetch("/api/admin/commerce-configuration/membership-price")
        .then((response) => response.json() as Promise<RpcResult<MembershipPriceConfigurationView>>)
        .then((result) => active && setMembership(result))
        .catch(() => active && setMembership(networkFailure("Membership Price")));
    }
    if (canReadServiceFee) {
      setServiceFee(null);
      void fetch("/api/admin/commerce-configuration/service-fee")
        .then((response) => response.json() as Promise<RpcResult<ServiceFeeConfigurationView>>)
        .then((result) => active && setServiceFee(result))
        .catch(() => active && setServiceFee(networkFailure("Service Fee")));
    }
    return () => {
      active = false;
    };
  }, [admin.state.phase, attempt, canReadMembership, canReadServiceFee]);

  async function replaceMembership(replacement: MembershipPriceReplacement) {
    if (!membership?.ok) return;
    const result = await submit<MembershipPriceConfigurationView>(
      "/api/admin/commerce-configuration/membership-price",
      { ...replacement, expectedVersion: membership.value.version },
    );
    if (result.ok) {
      setScheduledMembership(result.value);
      setAttempt((value) => value + 1);
    }
    handleResult(result, "Membership Price replacement created");
  }

  async function replaceServiceFee(replacement: ServiceFeeReplacement) {
    if (!serviceFee?.ok) return;
    const result = await submit<ServiceFeeConfigurationView>(
      "/api/admin/commerce-configuration/service-fee",
      { ...replacement, expectedVersion: serviceFee.value.version },
    );
    if (result.ok) {
      setScheduledServiceFee(result.value);
      setAttempt((value) => value + 1);
    }
    handleResult(result, "Service Fee replacement created");
  }

  async function submit<T>(url: string, body: object): Promise<RpcResult<T>> {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      return (await response.json()) as RpcResult<T>;
    } catch {
      return networkFailure<T>("Commerce configuration command");
    } finally {
      setPending(false);
    }
  }

  function handleResult<T>(result: RpcResult<T>, successTitle: string) {
    if (result.ok) {
      setNotice({
        tone: "success",
        title: successTitle,
        message: "The new effective-dated version and its immutable audit evidence were recorded.",
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

  const selectedResult = activeTab === "membership" ? membership : serviceFee;
  const canReadSelected = activeTab === "membership" ? canReadMembership : canReadServiceFee;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pricing & fees"
        description="Global effective-dated Membership Price and FreshMarkets Instant Service Fee configuration."
      />
      {notice ? (
        <CommandBanner
          tone={notice.tone}
          title={notice.title}
          message={notice.message}
          action={
            notice.tone === "conflict" ? (
              <Button onClick={refresh}>Refresh current version</Button>
            ) : undefined
          }
        />
      ) : null}
      {admin.state.phase !== "ready" || (canReadSelected && selectedResult === null) ? (
        <Skeleton className="h-96 w-full" />
      ) : null}
      {admin.state.phase === "ready" && !canReadSelected ? (
        <Alert>
          <AlertTitle>Configuration is not available to this role</AlertTitle>
          <AlertDescription>
            {activeTab === "membership" ? "memberships.read" : "payments.read"} is required to view
            the current authoritative version.
          </AlertDescription>
        </Alert>
      ) : null}
      {selectedResult && !selectedResult.ok ? (
        <Alert variant="destructive">
          <AlertTitle>Configuration could not be loaded</AlertTitle>
          <AlertDescription>
            {selectedResult.error.message} Request reference: {selectedResult.error.requestId}
          </AlertDescription>
        </Alert>
      ) : null}
      {admin.state.phase === "ready" && selectedResult?.ok ? (
        <CommerceConfigurationView
          activeTab={activeTab}
          membership={membership?.ok ? membership.value : null}
          serviceFee={serviceFee?.ok ? serviceFee.value : null}
          scheduledMembership={scheduledMembership}
          scheduledServiceFee={scheduledServiceFee}
          canManageMembership={canManageMembership}
          canManageServiceFee={canManageServiceFee}
          pending={pending}
          onMembershipSubmit={(replacement) => void replaceMembership(replacement)}
          onServiceFeeSubmit={(replacement) => void replaceServiceFee(replacement)}
        />
      ) : null}
    </div>
  );
}

function networkFailure<T>(label: string): RpcResult<T> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: `Network error loading ${label}.`,
      requestId: "unavailable",
    },
  };
}
