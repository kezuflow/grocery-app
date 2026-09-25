"use client";
import { useCallback, useEffect, useRef, useState, use } from "react";
import { useAdminCommand } from "../../../../components/admin/use-admin-command";
import Link from "next/link";
import {
  adminCapabilityCodes,
  adminRoleStatuses,
  type AdminRolePage,
  type AdminStaffDetail,
  type AdminStaffScopesRequest,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Skeleton } from "../../../../components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { PageHeader, ListPageSection, StatusBadge } from "../../../../components/admin/admin-shell";
import {
  AdminCursorPagination,
  AdminConfirmationDialog,
  useAdminPagination,
} from "../../../../components/admin/admin-controls";
import { useAdminScopeGuard } from "../../../../app/admin/admin-context-provider";
import { useAdminRouteGuard } from "../../../../components/admin/use-admin-route-guard";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready"; staff: AdminStaffDetail; roles: AdminRolePage };

const scopeResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.array(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("location"),
          marketId: z.string(),
          marketCode: z.string(),
          locationId: z.string(),
          locationName: z.string(),
        }),
        z.object({
          kind: z.literal("market"),
          marketId: z.string(),
          marketCode: z.string(),
          marketName: z.string(),
        }),
      ]),
    ),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({ message: z.string(), requestId: z.string() }),
  }),
]);
type ScopeOption = Extract<z.infer<typeof scopeResultSchema>, { ok: true }>["value"][number];
type Confirmation =
  | { kind: "access"; action: "SUSPEND" | "ACTIVATE"; expectedVersion: number }
  | { kind: "sessions" }
  | { kind: "roles"; roleIds: string[]; expectedVersion: number; roleName: string; grant: boolean }
  | {
      kind: "scopes";
      scopes: AdminStaffScopesRequest["scopes"];
      expectedVersion: number;
      label: string;
    };
const errorResultSchema = z.object({
  ok: z.literal(false),
  error: z.object({ message: z.string(), requestId: z.string() }),
});
const staffResultSchema = z.discriminatedUnion("ok", [
  errorResultSchema,
  z.object({
    ok: z.literal(true),
    value: z.object({
      staffId: z.string(),
      authUserId: z.string(),
      displayName: z.string(),
      email: z.string(),
      status: z.enum(["active", "suspended"]),
      roleCodes: z.array(z.string()),
      roleIds: z.array(z.string()),
      capabilityCodes: z.array(z.enum(adminCapabilityCodes)),
      version: z.number().int().positive(),
      createdAt: z.string(),
      scopes: z.array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("global") }),
          z.object({ kind: z.literal("market"), marketId: z.string() }),
          z.object({ kind: z.literal("location"), locationId: z.string() }),
        ]),
      ),
    }),
  }),
]);
const rolesResultSchema = z.discriminatedUnion("ok", [
  errorResultSchema,
  z.object({
    ok: z.literal(true),
    value: z.object({
      nextCursor: z.string().nullable(),
      items: z.array(
        z.object({
          roleId: z.string(),
          code: z.string(),
          name: z.string(),
          description: z.string(),
          status: z.enum(adminRoleStatuses),
          capabilityCodes: z.array(z.enum(adminCapabilityCodes)),
          version: z.number().int().positive(),
        }),
      ),
    }),
  }),
]);

export default function StaffDetailPage({ params }: { params: Promise<{ "staff-id": string }> }) {
  const { "staff-id": staffId } = use(params);
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [reason, setReason] = useState("");
  const command = useAdminCommand();
  const { notice, setNotice, busy, uncertain } = command;
  const [displayName, setDisplayName] = useState("");
  const [scopeOptions, setScopeOptions] = useState<ScopeOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const loadedStaff = useRef<AdminStaffDetail | null>(null);
  const loadSequence = useRef(0);
  const confirmationTrigger = useRef<HTMLElement | null>(null);
  const rolePagination = useAdminPagination();
  const staffForGuard = state.phase === "ready" ? state.staff : null;
  const originalLocationId =
    staffForGuard?.scopes.find((scope) => scope.kind === "location")?.locationId ?? "";
  const dirty = Boolean(
    staffForGuard &&
    (displayName !== staffForGuard.displayName ||
      locationId !== originalLocationId ||
      reason.trim().length > 0),
  );
  const locked = busy || uncertain || confirmation !== null;
  useAdminScopeGuard(dirty, locked, () => {
    if (staffForGuard) {
      setDisplayName(staffForGuard.displayName);
      setLocationId(originalLocationId);
    }
    setReason("");
  });
  useAdminRouteGuard(dirty, locked);

  const load = useCallback(
    (roleCursor: string | null) => {
      const sequence = ++loadSequence.current;
      setState((current) => (current.phase === "ready" ? current : { phase: "loading" }));
      void (async () => {
        try {
          const [staffResult, rolesResult, scopesResult] = await Promise.allSettled([
            fetch(`/api/admin/staff/${encodeURIComponent(staffId)}`).then(async (response) =>
              staffResultSchema.parse(await response.json()),
            ),
            fetch(
              `/api/admin/roles?limit=100${roleCursor ? `&cursor=${encodeURIComponent(roleCursor)}` : ""}`,
            ).then(async (response) => rolesResultSchema.parse(await response.json())),
            fetch("/api/admin/scopes").then(async (response) =>
              scopeResultSchema.parse(await response.json()),
            ),
          ]);
          if (sequence !== loadSequence.current) return;
          if (staffResult.status === "rejected") throw new Error("Staff read failed");
          const staffPayload = staffResult.value;
          if (!staffPayload.ok) {
            setReadError(staffPayload.error.message);
            setState((current) =>
              current.phase === "ready"
                ? current
                : {
                    phase: "error",
                    message: staffPayload.error.message,
                    requestId: staffPayload.error.requestId,
                  },
            );
            return;
          }
          const rolesPayload = rolesResult.status === "fulfilled" ? rolesResult.value : null;
          const scopesPayload = scopesResult.status === "fulfilled" ? scopesResult.value : null;
          setRoleError(rolesPayload?.ok ? null : "Role choices could not be loaded. Retry read.");
          setScopeError(
            scopesPayload?.ok ? null : "Location choices could not be loaded. Retry read.",
          );
          if (scopesPayload?.ok) setScopeOptions(scopesPayload.value);
          const previousStaff = loadedStaff.current;
          setDisplayName((current) =>
            !previousStaff || current === previousStaff.displayName
              ? staffPayload.value.displayName
              : current,
          );
          setLocationId((current) => {
            const priorLocation =
              previousStaff?.scopes.find((scope) => scope.kind === "location")?.locationId ?? "";
            return !previousStaff || current === priorLocation
              ? (staffPayload.value.scopes.find((scope) => scope.kind === "location")?.locationId ??
                  "")
              : current;
          });
          loadedStaff.current = staffPayload.value;
          setState((current) => ({
            phase: "ready",
            staff: staffPayload.value,
            roles: rolesPayload?.ok
              ? rolesPayload.value
              : current.phase === "ready"
                ? current.roles
                : { items: [], nextCursor: null },
          }));
          setReadError(null);
        } catch {
          if (sequence !== loadSequence.current) return;
          setReadError("Network error loading staff.");
          setState((current) =>
            current.phase === "ready"
              ? current
              : { phase: "error", message: "Network error loading staff.", requestId: null },
          );
        }
      })();
    },
    [staffId],
  );

  useEffect(() => load(rolePagination.cursor), [load, rolePagination.cursor]);

  async function run(
    operation: string,
    url: string,
    method: "POST" | "PUT" | "PATCH",
    body: unknown,
    successTitle: string,
  ) {
    loadSequence.current += 1;
    const ok = await command.run(operation, url, body, method, { title: successTitle });
    if (ok) load(rolePagination.cursor);
    return ok;
  }

  if (state.phase === "loading") {
    return (
      <div className="space-y-3" role="status" aria-label="Loading staff member">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>The staff member could not be loaded</AlertTitle>
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

  const { staff, roles } = state;
  const activeRoles = roles.items.filter((role) => role.status === "ACTIVE");
  const assignedRoleIds = new Set(staff.roleIds);
  const selectedLocation = scopeOptions.find(
    (option) => option.kind === "location" && option.locationId === locationId,
  );

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title={staff.displayName}
        description={`${staff.email} · v${staff.version}`}
        action={
          <StatusBadge tone={staff.status === "active" ? "success" : "warning"}>
            {staff.status}
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

      {readError || roleError || scopeError ? (
        <Alert variant="destructive">
          <AlertTitle>Staff details need attention</AlertTitle>
          <AlertDescription>
            {[readError, roleError, scopeError].filter(Boolean).join(" ")}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-3"
              onClick={() => load(rolePagination.cursor)}
            >
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
              if (ok) load(rolePagination.cursor);
            })
          }
        >
          Retry unconfirmed action
        </Button>
      ) : null}
      <fieldset disabled={busy || uncertain || Boolean(readError)} className="min-w-0 space-y-6">
        <ListPageSection title="Profile" description="Display identity used in Admin workflows.">
          <form
            className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center"
            onSubmit={(event) => {
              event.preventDefault();
              if (displayName.trim() === "") {
                setNotice("A display name is required.");
                return;
              }
              void run(
                "profile",
                `/api/admin/staff/${encodeURIComponent(staffId)}`,
                "PATCH",
                {
                  displayName: displayName.trim(),
                  expectedVersion: staff.version,
                },
                "Staff profile saved",
              );
            }}
          >
            <Input
              aria-label="Staff display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="sm:w-72"
            />
            <Button type="submit" size="sm">
              Save profile
            </Button>
          </form>
        </ListPageSection>

        <ListPageSection title="Access" description="Suspension is application-owned and audited.">
          <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
            <Input
              aria-label="Reason for access change"
              placeholder="reason (required)"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="sm:w-72"
            />
            <Button
              size="sm"
              variant={staff.status === "active" ? "destructive" : "default"}
              onClick={(event) => {
                confirmationTrigger.current = event.currentTarget;
                setConfirmation({
                  kind: "access",
                  action: staff.status === "active" ? "SUSPEND" : "ACTIVATE",
                  expectedVersion: staff.version,
                });
              }}
            >
              {staff.status === "active" ? "Suspend" : "Activate"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={(event) => {
                confirmationTrigger.current = event.currentTarget;
                setConfirmation({ kind: "sessions" });
              }}
            >
              Revoke sessions
            </Button>
          </div>
        </ListPageSection>

        <ListPageSection
          title="Roles"
          description="Atomic replacement: save applies exactly this set."
        >
          <div className="space-y-2 p-4">
            {roleError ? (
              <p className="text-sm text-[var(--fm-text-muted)]" role="status">
                Role choices for this page are unavailable. Retry the read or return to the previous
                page.
              </p>
            ) : activeRoles.length === 0 ? (
              <p className="text-sm text-[var(--fm-text-muted)]">
                No active roles exist. Create one under Roles.
              </p>
            ) : (
              activeRoles.map((role) => (
                <label key={role.roleId} className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    disabled={Boolean(roleError)}
                    checked={assignedRoleIds.has(role.roleId)}
                    onChange={(event) => {
                      confirmationTrigger.current = event.currentTarget;
                      const next = new Set(assignedRoleIds);
                      if (event.target.checked) next.add(role.roleId);
                      else next.delete(role.roleId);
                      setConfirmation({
                        kind: "roles",
                        roleIds: [...next],
                        expectedVersion: staff.version,
                        roleName: role.name,
                        grant: event.target.checked,
                      });
                    }}
                  />
                  <span className="font-medium">{role.name}</span>
                  <span className="text-xs text-[var(--fm-text-muted)]">{role.code}</span>
                </label>
              ))
            )}
          </div>
          <AdminCursorPagination
            pageNumber={rolePagination.pageNumber}
            nextCursor={roleError ? null : roles.nextCursor}
            pending={locked}
            onPrevious={rolePagination.previous}
            onNext={rolePagination.next}
          />
        </ListPageSection>

        <ListPageSection
          title="Scopes"
          description="Replace authority with Global access or a named operational location."
        >
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Select
              value={locationId}
              onValueChange={setLocationId}
              disabled={busy || uncertain || Boolean(scopeError)}
            >
              <SelectTrigger aria-label="Staff location">
                <SelectValue placeholder="Choose a location" />
              </SelectTrigger>
              <SelectContent>
                {scopeOptions
                  .filter((scope) => scope.kind === "location")
                  .map((scope) => (
                    <SelectItem key={scope.locationId} value={scope.locationId}>
                      {scope.locationName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(scopeError)}
                onClick={(event) => {
                  confirmationTrigger.current = event.currentTarget;
                  setConfirmation({
                    kind: "scopes",
                    scopes: [{ kind: "global" }],
                    expectedVersion: staff.version,
                    label: "Global",
                  });
                }}
              >
                Set global
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={locationId.trim() === "" || Boolean(scopeError)}
                onClick={(event) => {
                  confirmationTrigger.current = event.currentTarget;
                  setConfirmation({
                    kind: "scopes",
                    scopes: [{ kind: "location", locationId: locationId.trim() }],
                    expectedVersion: staff.version,
                    label:
                      selectedLocation?.kind === "location"
                        ? selectedLocation.locationName
                        : "Selected location",
                  });
                }}
              >
                Set location
              </Button>
            </div>
            <p className="text-xs text-[var(--fm-text-muted)] sm:col-span-2">
              Current:{" "}
              {staff.scopes
                .map((scope) => {
                  if (scope.kind === "global") return "Global";
                  if (scope.kind === "location") {
                    const option = scopeOptions.find(
                      (option) =>
                        option.kind === "location" && option.locationId === scope.locationId,
                    );
                    return option?.kind === "location"
                      ? option.locationName
                      : "Unavailable location (retained assignment)";
                  }
                  return (
                    scopeOptions.find((option) => option.marketId === scope.marketId)?.marketCode ??
                    "Retained market assignment"
                  );
                })
                .join(", ") || "No assigned scope"}
            </p>
          </div>
        </ListPageSection>
      </fieldset>
      <AdminConfirmationDialog
        open={confirmation !== null}
        title={
          confirmation?.kind === "access"
            ? confirmation.action === "SUSPEND"
              ? "Suspend staff access?"
              : "Activate staff access?"
            : confirmation?.kind === "sessions"
              ? "Revoke staff sessions?"
              : confirmation?.kind === "roles"
                ? "Change staff roles?"
                : "Change staff scope?"
        }
        resource={staff.displayName}
        restoreFocusRef={confirmationTrigger}
        scope={confirmation?.kind === "scopes" ? confirmation.label : "Global"}
        consequence={
          confirmation?.kind === "sessions"
            ? "All current sessions for this staff member will be revoked."
            : confirmation?.kind === "roles"
              ? `${confirmation.grant ? "Grant" : "Remove"} ${confirmation.roleName}. This replaces the staff member’s assigned roles and their resulting access.`
              : confirmation?.kind === "scopes"
                ? "This replaces the staff member’s operational scope."
                : confirmation?.action === "SUSPEND"
                  ? "This suspends Admin access for this staff member."
                  : "This restores Admin access for this staff member."
        }
        reasonRequired={confirmation?.kind === "access" || confirmation?.kind === "sessions"}
        initialReason={reason}
        reasonLocked={uncertain}
        destructive={confirmation?.kind !== "access" || confirmation.action === "SUSPEND"}
        pending={busy}
        cancelDisabled={uncertain}
        error={confirmation && notice && notice !== "Done." ? notice : undefined}
        confirmLabel={uncertain ? "Retry unconfirmed action" : "Confirm change"}
        onCancel={() => {
          if (!uncertain) setConfirmation(null);
        }}
        onConfirm={(confirmedReason) => {
          if (!confirmation) return;
          if (uncertain) {
            void command.retry().then((ok) => {
              if (ok) {
                setConfirmation(null);
                setReason("");
                load(rolePagination.cursor);
              }
            });
            return;
          }
          const operation = confirmation.kind;
          const url = `/api/admin/staff/${encodeURIComponent(staffId)}/${operation === "sessions" ? "sessions/revoke" : operation}`;
          const method = operation === "roles" || operation === "scopes" ? "PUT" : "POST";
          const body =
            confirmation.kind === "access"
              ? {
                  action: confirmation.action,
                  reason: confirmedReason,
                  expectedVersion: confirmation.expectedVersion,
                }
              : confirmation.kind === "sessions"
                ? { reason: confirmedReason }
                : confirmation.kind === "roles"
                  ? { roleIds: confirmation.roleIds, expectedVersion: confirmation.expectedVersion }
                  : { scopes: confirmation.scopes, expectedVersion: confirmation.expectedVersion };
          void run(
            operation,
            url,
            method,
            body,
            operation === "access"
              ? confirmation.action === "SUSPEND"
                ? "Staff access suspended"
                : "Staff access activated"
              : operation === "sessions"
                ? "Staff sessions revoked"
                : operation === "roles"
                  ? "Staff roles saved"
                  : "Staff scope saved",
          ).then((ok) => {
            if (ok) {
              setConfirmation(null);
              setReason("");
            }
          });
        }}
      />
      <p className="text-xs">
        <Link href="/admin/staff/roles" className="text-[var(--fm-info)] underline">
          Manage roles and capabilities
        </Link>
      </p>
    </div>
  );
}
