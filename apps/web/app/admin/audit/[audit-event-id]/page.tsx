"use client";

import { use, useCallback, useEffect, useState } from "react";
import type { AdminAuditEventView, RpcResult } from "@freshmarkets/contracts";
import { AuditDetailView, type AuditDetailState } from "../audit-detail-view";

export default function AuditEventDetailPage({
  params,
}: {
  params: Promise<{ "audit-event-id": string }>;
}) {
  const { "audit-event-id": auditEventId } = use(params);
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
  return <AuditDetailView state={state} />;
}
