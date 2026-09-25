"use client";
import { useCallback, useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import type {
  AdminRoleSummary,
  CapabilityDefinitionView,
  RpcResult,
} from "@freshmarkets/contracts";
import { Button } from "../../../../../components/ui/button";
import { Input } from "../../../../../components/ui/input";
import { Skeleton } from "../../../../../components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "../../../../../components/ui/alert";
import {
  PageHeader,
  ListPageSection,
  StatusBadge,
} from "../../../../../components/admin/admin-shell";
import { useAdminCommand } from "../../../../../components/admin/use-admin-command";
import { AdminConfirmationDialog } from "../../../../../components/admin/admin-controls";
import { useAdminScopeGuard } from "../../../../../app/admin/admin-context-provider";
import { useAdminRouteGuard } from "../../../../../components/admin/use-admin-route-guard";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | {
      phase: "ready";
      role: AdminRoleSummary;
      capabilities: ReadonlyArray<CapabilityDefinitionView>;
    };
type Confirmation =
  | {
      kind: "capabilities";
      capabilityCodes: string[];
      expectedVersion: number;
      code: string;
      grant: boolean;
    }
  | { kind: "archive"; expectedVersion: number };

export default function RoleDetailPage({ params }: { params: Promise<{ "role-id": string }> }) {
  const { "role-id": roleId } = use(params);
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [archiveReason, setArchiveReason] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const loadedRoleRef = useRef<AdminRoleSummary | null>(null);
  const loadSequence = useRef(0);
  const confirmationTrigger = useRef<HTMLElement | null>(null);
  const backLink = useRef<HTMLAnchorElement | null>(null);
  const command = useAdminCommand();
  const { notice, setNotice, busy, uncertain } = command;
  const loadedRole = state.phase === "ready" ? state.role : null;
  const dirty = Boolean(
    loadedRole &&
    (name !== loadedRole.name ||
      description !== loadedRole.description ||
      archiveReason.trim().length > 0),
  );
  const locked = busy || uncertain || confirmation !== null;
  useAdminScopeGuard(dirty, locked, () => {
    if (loadedRole) {
      setName(loadedRole.name);
      setDescription(loadedRole.description);
    }
    setArchiveReason("");
  });
  useAdminRouteGuard(dirty, locked);

  const load = useCallback(() => {
    const sequence = ++loadSequence.current;
    setState((current) => (current.phase === "ready" ? current : { phase: "loading" }));
    void (async () => {
      try {
        const [roleResponse, capabilityResponse] = await Promise.all([
          fetch(`/api/admin/roles/${encodeURIComponent(roleId)}`),
          fetch("/api/admin/capabilities"),
        ]);
        if (sequence !== loadSequence.current) return;
        const rolePayload = (await roleResponse.json()) as RpcResult<AdminRoleSummary>;
        if (sequence !== loadSequence.current) return;
        if (!rolePayload.ok) {
          setReadError(rolePayload.error.message);
          setState((current) =>
            current.phase === "ready"
              ? current
              : {
                  phase: "error",
                  message: rolePayload.error.message,
                  requestId: rolePayload.error.requestId,
                },
          );
          return;
        }
        const capabilityPayload = (await capabilityResponse.json()) as RpcResult<
          ReadonlyArray<CapabilityDefinitionView>
        >;
        if (sequence !== loadSequence.current) return;
        setState((current) => ({
          phase: "ready",
          role: rolePayload.value,
          capabilities: capabilityPayload.ok
            ? capabilityPayload.value
            : current.phase === "ready"
              ? current.capabilities
              : [],
        }));
        setCapabilityError(capabilityPayload.ok ? null : capabilityPayload.error.message);
        setReadError(null);
        const previousRole = loadedRoleRef.current;
        setName((current) =>
          !previousRole || current === previousRole.name ? rolePayload.value.name : current,
        );
        setDescription((current) =>
          !previousRole || current === previousRole.description
            ? rolePayload.value.description
            : current,
        );
        loadedRoleRef.current = rolePayload.value;
      } catch {
        if (sequence !== loadSequence.current) return;
        setReadError("Network error loading the role.");
        setState((current) =>
          current.phase === "ready"
            ? current
            : { phase: "error", message: "Network error loading the role.", requestId: null },
        );
      }
    })();
  }, [roleId]);

  useEffect(() => load(), [load]);

  async function run(
    url: string,
    method: "POST" | "PUT" | "PATCH",
    body: unknown,
    successTitle: string,
  ) {
    loadSequence.current += 1;
    const ok = await command.run(url, url, body, method, { title: successTitle });
    if (ok) load();
    return ok;
  }
  if (state.phase === "loading") {
    return (
      <div className="space-y-3" role="status" aria-label="Loading role">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>The role could not be loaded</AlertTitle>
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

  const { role, capabilities } = state;
  const assigned = new Set(role.capabilityCodes);

  return (
    <div className="w-full space-y-6">
      <Link
        ref={backLink}
        href="/admin/staff/roles"
        className="text-sm font-medium text-[var(--fm-info)] underline"
      >
        Back to roles
      </Link>
      <PageHeader
        title={role.name}
        description={`${role.code} · v${role.version}`}
        action={
          <StatusBadge tone={role.status === "ACTIVE" ? "success" : "neutral"}>
            {role.status}
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
      {readError || capabilityError ? (
        <Alert variant="destructive">
          <AlertTitle>Access details need attention</AlertTitle>
          <AlertDescription>
            {readError ?? `Capability options unavailable: ${capabilityError}`}
            <Button type="button" size="sm" variant="outline" className="ml-3" onClick={load}>
              Retry read
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {uncertain && !confirmation ? (
        <Button
          disabled={busy}
          onClick={() =>
            void command.retry().then((ok) => {
              if (ok) load();
            })
          }
        >
          Retry unconfirmed action
        </Button>
      ) : null}
      <fieldset disabled={busy || uncertain || Boolean(readError)} className="min-w-0 space-y-6">
        {role.status === "ACTIVE" ? (
          <ListPageSection title="Identity" description="Rename or re-describe the role.">
            <form
              className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  `/api/admin/roles/${encodeURIComponent(roleId)}`,
                  "PATCH",
                  {
                    name: name.trim(),
                    description: description.trim(),
                    expectedVersion: role.version,
                  },
                  "Role details saved",
                );
              }}
            >
              <Input
                aria-label="Role name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="sm:w-64"
              />
              <Input
                aria-label="Role description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="sm:w-80"
              />
              <Button type="submit" size="sm">
                Save
              </Button>
            </form>
          </ListPageSection>
        ) : null}

        <ListPageSection
          title="Capabilities"
          description={
            role.status === "ACTIVE"
              ? "Atomic replacement over the closed canonical vocabulary."
              : "Archived roles keep their history and cannot change capabilities."
          }
        >
          <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map((capability) => (
              <label key={capability.code} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={role.status !== "ACTIVE" || Boolean(capabilityError)}
                  checked={assigned.has(capability.code)}
                  onChange={(event) => {
                    confirmationTrigger.current = event.currentTarget;
                    const next = new Set(assigned);
                    if (event.target.checked) next.add(capability.code);
                    else next.delete(capability.code);
                    setConfirmation({
                      kind: "capabilities",
                      capabilityCodes: [...next],
                      expectedVersion: role.version,
                      code: capability.code,
                      grant: event.target.checked,
                    });
                  }}
                />
                <span className="font-mono text-xs">{capability.code}</span>
                <span className="text-xs text-[var(--fm-text-muted)]">
                  {capability.description}
                </span>
              </label>
            ))}
          </div>
        </ListPageSection>

        {role.status === "ACTIVE" ? (
          <ListPageSection
            title="Archive"
            description="Archiving preserves history; archived roles cannot be assigned."
          >
            <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
              <Input
                aria-label="Archive reason"
                placeholder="reason (required)"
                value={archiveReason}
                onChange={(event) => setArchiveReason(event.target.value)}
                className="sm:w-72"
              />
              <Button
                size="sm"
                variant="destructive"
                onClick={(event) => {
                  if (archiveReason.trim() === "") {
                    setNotice("An archive reason is required.");
                    return;
                  }
                  confirmationTrigger.current = event.currentTarget;
                  setConfirmation({ kind: "archive", expectedVersion: role.version });
                }}
              >
                Archive role
              </Button>
            </div>
          </ListPageSection>
        ) : null}
      </fieldset>
      <AdminConfirmationDialog
        open={confirmation !== null}
        title={
          confirmation?.kind === "archive" ? "Archive this role?" : "Change role capabilities?"
        }
        resource={role.name}
        restoreFocusRef={confirmationTrigger}
        scope="Global"
        consequence={
          confirmation?.kind === "archive"
            ? "This role can no longer be assigned. Existing history is retained."
            : `${confirmation?.grant ? "Grant" : "Remove"} ${confirmation?.code ?? "this capability"}. This changes the capabilities granted to staff assigned to this role.`
        }
        reasonRequired={confirmation?.kind === "archive"}
        initialReason={confirmation?.kind === "archive" ? archiveReason : ""}
        reasonLocked={uncertain}
        destructive
        pending={busy}
        cancelDisabled={uncertain}
        error={confirmation && notice && notice !== "Done." ? notice : undefined}
        confirmLabel={uncertain ? "Retry unconfirmed action" : "Confirm change"}
        onCancel={() => {
          if (!uncertain) setConfirmation(null);
        }}
        onConfirm={(reason) => {
          if (!confirmation) return;
          if (uncertain) {
            void command.retry().then((ok) => {
              if (ok) {
                if (confirmation.kind === "archive") confirmationTrigger.current = backLink.current;
                setConfirmation(null);
                setArchiveReason("");
                load();
              }
            });
            return;
          }
          const target =
            confirmation.kind === "archive"
              ? `/api/admin/roles/${encodeURIComponent(roleId)}/archive`
              : `/api/admin/roles/${encodeURIComponent(roleId)}/capabilities`;
          const body =
            confirmation.kind === "archive"
              ? { reason, expectedVersion: confirmation.expectedVersion }
              : {
                  capabilityCodes: confirmation.capabilityCodes,
                  expectedVersion: confirmation.expectedVersion,
                };
          void run(
            target,
            confirmation.kind === "archive" ? "POST" : "PUT",
            body,
            confirmation.kind === "archive" ? "Role archived" : "Role capabilities saved",
          ).then((ok) => {
            if (ok) {
              if (confirmation.kind === "archive") confirmationTrigger.current = backLink.current;
              setConfirmation(null);
              setArchiveReason("");
            }
          });
        }}
      />
    </div>
  );
}
