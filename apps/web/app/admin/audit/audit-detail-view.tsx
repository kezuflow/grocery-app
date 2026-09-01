import type { AdminAuditEventView } from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { ListPageSection, PageHeader } from "../../../components/admin/admin-shell";

export type AuditDetailState =
  | { phase: "loading" }
  | { phase: "error"; code: string; message: string; requestId: string | null }
  | { phase: "ready"; event: AdminAuditEventView };

function JsonEvidence({ value }: { value: Readonly<Record<string, unknown>> | null }) {
  if (value === null) return <p className="text-sm text-[var(--fm-muted)]">No value recorded.</p>;
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-[var(--fm-surface-subtle)] p-4 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function AuditDetailView({ state }: { state: AuditDetailState }) {
  if (state.phase === "loading") {
    return <p role="status">Loading audit event…</p>;
  }
  if (state.phase === "error") {
    const title =
      state.code === "NOT_FOUND"
        ? "Audit event not found"
        : state.code === "FORBIDDEN"
          ? "Audit access denied"
          : "Audit event unavailable";
    return (
      <Alert variant="destructive">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          {state.message}
          {state.requestId ? ` Request reference: ${state.requestId}` : ""}
        </AlertDescription>
      </Alert>
    );
  }

  const event = state.event;
  return (
    <div className="mx-auto max-w-[1000px] space-y-6">
      <PageHeader title={event.action} description={`Audit event ${event.auditEventId}`} />
      <ListPageSection title="Event" description="Immutable action and scope metadata.">
        <dl className="grid gap-4 p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium">Occurred</dt>
            <dd>{event.occurredAt}</dd>
          </div>
          <div>
            <dt className="font-medium">Actor</dt>
            <dd>{event.actorId ?? "System"}</dd>
          </div>
          <div>
            <dt className="font-medium">Resource</dt>
            <dd>
              {event.resourceType} · {event.resourceId}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Scope</dt>
            <dd>{event.locationId ?? event.marketId ?? "Global"}</dd>
          </div>
          <div>
            <dt className="font-medium">Reason</dt>
            <dd>{event.reason ?? "Not supplied"}</dd>
          </div>
          <div>
            <dt className="font-medium">Correlation</dt>
            <dd>{event.correlationId ?? "Not supplied"}</dd>
          </div>
        </dl>
      </ListPageSection>
      <ListPageSection title="Metadata" description="Sensitive fields are redacted by Core.">
        <div className="p-4">
          <JsonEvidence value={event.metadata} />
        </div>
      </ListPageSection>
      <div className="grid gap-6 lg:grid-cols-2">
        <ListPageSection title="Before" description="Sanitized state before the action.">
          <div className="p-4">
            <JsonEvidence value={event.before} />
          </div>
        </ListPageSection>
        <ListPageSection title="After" description="Sanitized state after the action.">
          <div className="p-4">
            <JsonEvidence value={event.after} />
          </div>
        </ListPageSection>
      </div>
    </div>
  );
}
