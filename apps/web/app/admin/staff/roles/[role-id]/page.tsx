"use client";
import { useCallback, useEffect, useState, use } from "react";
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
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../../../../../components/ui/breadcrumb";
import {
  PageHeader,
  ListPageSection,
  StatusBadge,
} from "../../../../../components/admin/admin-shell";
import { useAdminCommandIntent } from "../../../../../components/admin/admin-command-state";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | {
      phase: "ready";
      role: AdminRoleSummary;
      capabilities: ReadonlyArray<CapabilityDefinitionView>;
    };

export default function RoleDetailPage({ params }: { params: Promise<{ "role-id": string }> }) {
  const { "role-id": roleId } = use(params);
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [archiveReason, setArchiveReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const commandIntent = useAdminCommandIntent();

  const load = useCallback(() => {
    setState({ phase: "loading" });
    void (async () => {
      try {
        const [roleResponse, capabilityResponse] = await Promise.all([
          fetch(`/api/admin/roles/${encodeURIComponent(roleId)}`),
          fetch("/api/admin/capabilities"),
        ]);
        const rolePayload = (await roleResponse.json()) as RpcResult<AdminRoleSummary>;
        if (!rolePayload.ok) {
          setState({
            phase: "error",
            message: rolePayload.error.message,
            requestId: rolePayload.error.requestId,
          });
          return;
        }
        const capabilityPayload = (await capabilityResponse.json()) as RpcResult<
          ReadonlyArray<CapabilityDefinitionView>
        >;
        setState({
          phase: "ready",
          role: rolePayload.value,
          capabilities: capabilityPayload.ok ? capabilityPayload.value : [],
        });
        setName(rolePayload.value.name);
        setDescription(rolePayload.value.description);
      } catch {
        setState({ phase: "error", message: "Network error loading the role.", requestId: null });
      }
    })();
  }, [roleId]);

  useEffect(() => load(), [load]);

  async function run(url: string, method: "POST" | "PUT" | "PATCH", body: unknown) {
    const payload = await commandIntent.submit(async (idempotencyKey) => {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(body),
      });
      return (await response.json()) as RpcResult<unknown>;
    });
    setNotice(payload.ok ? "Applied." : (payload.error?.message ?? "The command failed."));
    if (payload.ok) load();
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
    <div className="mx-auto max-w-[1280px] space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Admin</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin/staff/roles">Roles</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{role.code}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
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
          className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-3 text-sm"
        >
          {notice}
        </p>
      ) : null}

      {role.status === "ACTIVE" ? (
        <ListPageSection title="Identity" description="Rename or re-describe the role.">
          <form
            className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center"
            onSubmit={(event) => {
              event.preventDefault();
              void run(`/api/admin/roles/${encodeURIComponent(roleId)}`, "PATCH", {
                name: name.trim(),
                description: description.trim(),
                expectedVersion: role.version,
              });
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
                disabled={role.status !== "ACTIVE"}
                checked={assigned.has(capability.code)}
                onChange={(event) => {
                  const next = new Set(assigned);
                  if (event.target.checked) next.add(capability.code);
                  else next.delete(capability.code);
                  void run(`/api/admin/roles/${encodeURIComponent(roleId)}/capabilities`, "PUT", {
                    capabilityCodes: [...next],
                    expectedVersion: role.version,
                  });
                }}
              />
              <span className="font-mono text-xs">{capability.code}</span>
              <span className="text-xs text-[var(--fm-text-muted)]">{capability.description}</span>
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
              onClick={() => {
                if (archiveReason.trim() === "") {
                  setNotice("An archive reason is required.");
                  return;
                }
                void run(`/api/admin/roles/${encodeURIComponent(roleId)}/archive`, "POST", {
                  reason: archiveReason.trim(),
                  expectedVersion: role.version,
                });
              }}
            >
              Archive role
            </Button>
          </div>
        </ListPageSection>
      ) : null}
    </div>
  );
}
