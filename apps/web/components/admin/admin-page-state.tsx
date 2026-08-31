import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

export type AdminPageStateKind =
  | "loading"
  | "empty"
  | "filtered-empty"
  | "permission-empty"
  | "unavailable"
  | "pending"
  | "conflict"
  | "success"
  | "error";

const defaultMessages: Record<AdminPageStateKind, string> = {
  loading: "Loading the latest Core-authorized data.",
  empty: "No data is available yet.",
  "filtered-empty": "No results match the active filters.",
  "permission-empty": "The selected scope or your permissions do not expose data.",
  unavailable: "Authoritative data for this section is not available.",
  pending: "The command is still pending authoritative confirmation.",
  conflict: "The record changed since this page was loaded.",
  success: "The authoritative command completed successfully.",
  error: "The workspace could not be loaded.",
};

/** Shared explicit loading/empty/scope/error surface for Admin workspaces. */
export function AdminPageState({
  state,
  title,
  message,
  requestId,
  onRetry,
}: {
  state: AdminPageStateKind;
  title?: string;
  message?: string;
  requestId?: string;
  onRetry?: () => void;
}) {
  const description = `${defaultMessages[state]}${message ? ` ${message}` : ""}`;
  if (state === "loading") {
    return (
      <div aria-live="polite" className="space-y-3" role="status">
        <span className="sr-only">{title ?? description}</span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (state === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>{title ?? "Workspace unavailable"}</AlertTitle>
        <AlertDescription>
          {description}
          {requestId ? (
            <>
              <br />
              <span className="font-mono text-xs">Request reference: {requestId}</span>
            </>
          ) : null}
          {onRetry ? (
            <>
              <br />
              <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>
                Retry
              </Button>
            </>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <section
      aria-live="polite"
      className={`rounded-[var(--fm-radius-panel)] border bg-white p-6 text-sm ${
        state === "conflict"
          ? "border-[var(--fm-warning-border)]"
          : state === "success"
            ? "border-[var(--fm-success-border)]"
            : "border-dashed border-[var(--fm-border)]"
      }`}
      role={state === "conflict" ? "alert" : "status"}
    >
      <h2 className="font-semibold">
        {title ?? (state === "filtered-empty" ? "No matching results" : "Nothing to show")}
      </h2>
      <p className="mt-1 text-[var(--fm-text-muted)]">{description}</p>
    </section>
  );
}

export function AdminLiveRegion({ message }: { message: string | null }) {
  return (
    <p
      aria-atomic="true"
      aria-live="polite"
      className={message ? "border p-3 text-sm" : "sr-only"}
      role="status"
    >
      {message ?? ""}
    </p>
  );
}

export function AdminDetailGrid({ children }: { children: ReactNode }) {
  return <dl className="grid gap-4 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">{children}</dl>;
}

export function AdminTimeline({
  children,
  emptyMessage = "No lifecycle events.",
}: {
  children?: ReactNode;
  emptyMessage?: string;
}) {
  return children ? (
    <ol className="divide-y text-sm">{children}</ol>
  ) : (
    <AdminPageState state="empty" message={emptyMessage} />
  );
}
