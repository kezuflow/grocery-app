"use client";
import { useCallback, useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import type { AdminRolePage, AdminStaffDetail, RpcResult } from "@freshmarkets/contracts";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Skeleton } from "../../../../components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../../../../components/ui/breadcrumb";
import { PageHeader, ListPageSection, StatusBadge } from "../../../../components/admin/admin-shell";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready"; staff: AdminStaffDetail; roles: AdminRolePage };

export default function StaffDetailPage({ params }: { params: Promise<{ "staff-id": string }> }) {
  const { "staff-id": staffId } = use(params);
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [marketId, setMarketId] = useState("");
  const [locationId, setLocationId] = useState("");
  const commandKeys = useRef(new Map<string, string>());

  const load = useCallback(() => {
    setState({ phase: "loading" });
    void (async () => {
      try {
        const [staffResponse, rolesResponse] = await Promise.all([
          fetch(`/api/admin/staff/${encodeURIComponent(staffId)}`),
          fetch("/api/admin/roles?limit=100"),
        ]);
        const staffPayload = (await staffResponse.json()) as RpcResult<AdminStaffDetail>;
        if (!staffPayload.ok) {
          setState({
            phase: "error",
            message: staffPayload.error.message,
            requestId: staffPayload.error.requestId,
          });
          return;
        }
        const rolesPayload = (await rolesResponse.json()) as RpcResult<AdminRolePage>;
        setDisplayName(staffPayload.value.displayName);
        setMarketId(
          staffPayload.value.scopes.find((scope) => scope.kind === "market")?.marketId ?? "",
        );
        setLocationId(
          staffPayload.value.scopes.find((scope) => scope.kind === "location")?.locationId ?? "",
        );
        setState({
          phase: "ready",
          staff: staffPayload.value,
          roles: rolesPayload.ok ? rolesPayload.value : { items: [], nextCursor: null },
        });
      } catch {
        setState({ phase: "error", message: "Network error loading staff.", requestId: null });
      }
    })();
  }, [staffId]);

  useEffect(() => load(), [load]);

  async function run(
    operation: string,
    url: string,
    method: "POST" | "PUT" | "PATCH",
    body: unknown,
  ) {
    const signature = `${operation}:${JSON.stringify(body)}`;
    const idempotencyKey = commandKeys.current.get(signature) ?? crypto.randomUUID();
    commandKeys.current.set(signature, idempotencyKey);
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as RpcResult<unknown> & {
      error?: { message?: string };
    };
    setNotice(payload.ok ? "Applied." : (payload.error?.message ?? "The command failed."));
    if (payload.ok) {
      commandKeys.current.delete(signature);
      load();
    }
    return payload.ok;
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
  const assignedRoleIds = new Set(
    staff.roleCodes
      .map((code) => activeRoles.find((role) => role.code === code)?.roleId)
      .filter((roleId): roleId is string => Boolean(roleId)),
  );

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Admin</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin/staff">Staff</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{staff.displayName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
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
          className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-3 text-sm"
        >
          {notice}
        </p>
      ) : null}

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
              void run("access", `/api/admin/staff/${encodeURIComponent(staffId)}/access`, "POST", {
                action: staff.status === "active" ? "SUSPEND" : "ACTIVATE",
                reason: reason.trim(),
                expectedVersion: staff.version,
              });
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
        description="Replace authority with a global scope, a market, or a location. Core validates active geography."
      >
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Input
            aria-label="Market ID"
            placeholder="market ID"
            value={marketId}
            onChange={(event) => setMarketId(event.target.value)}
          />
          <Input
            aria-label="Location ID"
            placeholder="location ID"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          />
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
              disabled={marketId.trim() === ""}
              onClick={() =>
                void run(
                  "scopes",
                  `/api/admin/staff/${encodeURIComponent(staffId)}/scopes`,
                  "PUT",
                  {
                    scopes: [{ kind: "market", marketId: marketId.trim() }],
                    expectedVersion: staff.version,
                  },
                )
              }
            >
              Set market
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
            Current: {staff.scopes.map((scope) => JSON.stringify(scope)).join(", ") || "none"}
          </p>
        </div>
      </ListPageSection>

      <p className="text-xs">
        <Link href="/admin/staff/roles" className="text-[var(--fm-info)] underline">
          Manage roles and capabilities
        </Link>
      </p>
    </div>
  );
}
