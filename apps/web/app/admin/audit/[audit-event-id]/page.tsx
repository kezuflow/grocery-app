"use client";

import { Suspense, use, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AdminAuditEventView, RpcResult } from "@freshmarkets/contracts";
import { AuditDetailView, type AuditDetailState } from "../audit-detail-view";

export default function AuditEventDetailPage({
  params,
}: {
  params: Promise<{ "audit-event-id": string }>;
}) {
  return (
    <Suspense fallback={<p role="status">Loading audit event…</p>}>
      <AuditEventDetail params={params} />
    </Suspense>
  );
}

function AuditEventDetail({ params }: { params: Promise<{ "audit-event-id": string }> }) {
  const { "audit-event-id": auditEventId } = use(params);
  const searchParams = useSearchParams();
  const [state, setState] = useState<AuditDetailState>({ phase: "loading" });

  const load = useCallback(() => {
    setState({ phase: "loading" });
    void (async () => {
      try {
        const response = await fetch(`/api/admin/audit/${encodeURIComponent(auditEventId)}`);
        const result = (await response.json()) as RpcResult<AdminAuditEventView>;
        if (!result.ok) {
          setState({
            phase: "error",
            code: result.error.code,
            message: result.error.message,
            requestId: result.error.requestId,
          });
          return;
        }
        setState({ phase: "ready", event: result.value });
      } catch {
        setState({
          phase: "error",
          code: "NETWORK_ERROR",
          message: "The audit event could not be loaded.",
          requestId: null,
        });
      }
    })();
  }, [auditEventId]);

  useEffect(() => load(), [load]);
  const returnParams = new URLSearchParams();
  for (const key of [
    "action",
    "resourceType",
    "actorId",
    "locationId",
    "from",
    "to",
    "limit",
    "cursor",
  ]) {
    const value = searchParams.get(key);
    if (value) returnParams.set(key, value);
  }
  for (const value of searchParams.getAll("cursorHistory")) {
    returnParams.append("cursorHistory", value);
  }
  return (
    <AuditDetailView
      state={state}
      returnHref={`/admin/audit${returnParams.size ? `?${returnParams}` : ""}`}
    />
  );
}
