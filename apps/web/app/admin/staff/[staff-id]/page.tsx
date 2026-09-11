"use client";
import { useCallback, useEffect, useState, use } from "react";
import { useAdminCommand } from "../../../../components/admin/use-admin-command";
import Link from "next/link";
import {
  adminCapabilityCodes,
  adminRoleStatuses,
  type AdminRolePage,
  type AdminStaffDetail,
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
  useAdminPagination,
} from "../../../../components/admin/admin-controls";

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
  const rolePagination = useAdminPagination();

  const load = useCallback(
    (roleCursor: string | null) => {
      setState({ phase: "loading" });
      void (async () => {
        try {
          const [staffResponse, rolesResponse, scopesResponse] = await Promise.all([
            fetch(`/api/admin/staff/${encodeURIComponent(staffId)}`),
            fetch(
              `/api/admin/roles?limit=100${roleCursor ? `&cursor=${encodeURIComponent(roleCursor)}` : ""}`,
            ),
            fetch("/api/admin/scopes"),
          ]);
          const staffPayload = staffResultSchema.parse(await staffResponse.json());
          if (!staffPayload.ok) {
            setState({
              phase: "error",
              message: staffPayload.error.message,
              requestId: staffPayload.error.requestId,
            });
            return;
          }
          const rolesPayload = rolesResultSchema.parse(await rolesResponse.json());
          if (!rolesPayload.ok) {
            setState({
              phase: "error",
              message: rolesPayload.error.message,
              requestId: rolesPayload.error.requestId,
            });
            return;
          }
          const scopesPayload = scopeResultSchema.parse(await scopesResponse.json());
          if (!scopesPayload.ok) {
            setState({
              phase: "error",
              message: scopesPayload.error.message,
              requestId: scopesPayload.error.requestId,
            });
            return;
          }
          setScopeOptions(scopesPayload.value);
          setDisplayName(staffPayload.value.displayName);
          setLocationId(
            staffPayload.value.scopes.find((scope) => scope.kind === "location")?.locationId ?? "",
          );
          setState({
            phase: "ready",
            staff: staffPayload.value,
            roles: rolesPayload.value,
          });
        } catch {
          setState({ phase: "error", message: "Network error loading staff.", requestId: null });
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
  ) {
    const ok = await command.run(operation, url, body, method);
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

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
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

      {uncertain ? (
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
      <fieldset disabled={busy || uncertain} className="min-w-0 space-y-6">
        <ListPageSection title="Profile" description="Display identity used in Admin workflows.">
          <form
            className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center"
            onSubmit={(event) => {
              event.preventDefault();
              if (displayName.trim() === "") {
                setNotice("A display name is required.");
                return;
              }
              void run("profile", `/api/admin/staff/${encodeURIComponent(staffId)}`, "PATCH", {
                displayName: displayName.trim(),
                expectedVersion: staff.version,
              });
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
              onClick={() => {
                if (reason.trim() === "") {
                  setNotice("A reason is required.");
                  return;
                }
                void run(
                  "access",
                  `/api/admin/staff/${encodeURIComponent(staffId)}/access`,
                  "POST",
                  {
                    action: staff.status === "active" ? "SUSPEND" : "ACTIVATE",
                    reason: reason.trim(),
                    expectedVersion: staff.version,
                  },
                );
              }}
            >
              {staff.status === "active" ? "Suspend" : "Activate"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (reason.trim() === "") {
                  setNotice("A reason is required.");
                  return;
                }
                void run(
                  "sessions",
                  `/api/admin/staff/${encodeURIComponent(staffId)}/sessions/revoke`,
                  "POST",
                  {
                    reason: reason.trim(),
                  },
                );
              }}
            >
              Revoke sessions
            </Button>
          </div>
          <AdminCursorPagination
            pageNumber={rolePagination.pageNumber}
            nextCursor={roles.nextCursor}
            onPrevious={rolePagination.previous}
            onNext={rolePagination.next}
          />
        </ListPageSection>

        <ListPageSection
          title="Roles"
          description="Atomic replacement: save applies exactly this set."
        >
          <div className="space-y-2 p-4">
            {activeRoles.length === 0 ? (
              <p className="text-sm text-[var(--fm-text-muted)]">
                No active roles exist. Create one under Roles.
              </p>
            ) : (
              activeRoles.map((role) => (
                <label key={role.roleId} className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={assignedRoleIds.has(role.roleId)}
                    onChange={(event) => {
                      const next = new Set(assignedRoleIds);
                      if (event.target.checked) next.add(role.roleId);
                      else next.delete(role.roleId);
                      void run(
                        "roles",
                        `/api/admin/staff/${encodeURIComponent(staffId)}/roles`,
                        "PUT",
                        {
                          roleIds: [...next],
                          expectedVersion: staff.version,
                        },
                      );
                    }}
                  />
                  <span className="font-medium">{role.name}</span>
                  <span className="text-xs text-[var(--fm-text-muted)]">{role.code}</span>
                </label>
              ))
            )}
          </div>
        </ListPageSection>

        <ListPageSection
          title="Scopes"
          description="Replace authority with Global access or a named operational location."
        >
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Select value={locationId} onValueChange={setLocationId} disabled={busy || uncertain}>
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
                onClick={() =>
                  void run(
                    "scopes",
                    `/api/admin/staff/${encodeURIComponent(staffId)}/scopes`,
                    "PUT",
                    {
                      scopes: [{ kind: "global" }],
                      expectedVersion: staff.version,
                    },
                  )
                }
              >
                Set global
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={locationId.trim() === ""}
                onClick={() =>
                  void run(
                    "scopes",
                    `/api/admin/staff/${encodeURIComponent(staffId)}/scopes`,
                    "PUT",
                    {
                      scopes: [{ kind: "location", locationId: locationId.trim() }],
                      expectedVersion: staff.version,
                    },
                  )
                }
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
      <p className="text-xs">
        <Link href="/admin/staff/roles" className="text-[var(--fm-info)] underline">
          Manage roles and capabilities
        </Link>
      </p>
    </div>
  );
}
