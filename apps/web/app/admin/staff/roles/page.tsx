"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminRolePage, RpcResult } from "@freshmarkets/contracts";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Skeleton } from "../../../../components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../components/ui/table";
import { PageHeader, ListPageSection, StatusBadge } from "../../../../components/admin/admin-shell";
import { WorkspaceNavigation } from "../../../../components/admin/workspace-navigation";
import { useAdminCommandIntent } from "../../../../components/admin/admin-command-state";
import {
  AdminCursorPagination,
  useAdminPagination,
} from "../../../../components/admin/admin-controls";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready"; page: AdminRolePage };

export default function RolesPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const createIntent = useAdminCommandIntent();
  const pagination = useAdminPagination();

  const load = useCallback((cursor: string | null) => {
    setState({ phase: "loading" });
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/roles?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        const payload = (await response.json()) as RpcResult<AdminRolePage>;
        if (!payload.ok) {
          setState({
            phase: "error",
            message:
              payload.error.code === "FORBIDDEN"
                ? "Role administration requires the staff.read capability with a global scope."
                : payload.error.message,
            requestId: payload.error.requestId,
          });
          return;
        }
        setState({ phase: "ready", page: payload.value });
      } catch {
        setState({ phase: "error", message: "Network error loading roles.", requestId: null });
      }
    })();
  }, []);

  useEffect(() => load(pagination.cursor), [load, pagination.cursor]);

  async function createRole(event: React.FormEvent) {
    event.preventDefault();
    if (code.trim() === "" || name.trim() === "") {
      setNotice("A code and name are required.");
      return;
    }
    const payload = await createIntent.submit(async (idempotencyKey) => {
      const response = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          description: "",
          capabilityCodes: [],
        }),
      });
      return (await response.json()) as RpcResult<unknown>;
    });
    setNotice(
      payload.ok ? "Role created." : (payload.error?.message ?? "The role could not be created."),
    );
    if (payload.ok) {
      setCode("");
      setName("");
      load(pagination.cursor);
    }
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Roles"
        description="Capability sets over the closed canonical vocabulary."
      />
      <WorkspaceNavigation parentCode="staff" label="Staff administration" />

      {state.phase === "loading" ? (
        <div className="space-y-3" role="status" aria-label="Loading roles">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}

      {state.phase === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Roles could not be loaded</AlertTitle>
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
      ) : null}

      {state.phase === "ready" ? (
        <>
          {notice ? (
            <p
              role="status"
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-3 text-sm"
            >
              {notice}
            </p>
          ) : null}

          <ListPageSection
            title="Create a role"
            description="Starts empty; assign capabilities on the role page."
          >
            <form
              className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center"
              onSubmit={createRole}
            >
              <Input
                aria-label="Role code"
                placeholder="code, e.g. support_tier1"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="sm:w-56"
              />
              <Input
                aria-label="Role name"
                placeholder="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="sm:w-64"
              />
              <Button type="submit" size="sm">
                Create role
              </Button>
            </form>
          </ListPageSection>

          <ListPageSection title="Roles">
            {state.page.items.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
                No roles exist yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Capabilities</TableHead>
                    <TableHead>
                      <span className="sr-only">Detail link</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.page.items.map((role) => (
                    <TableRow key={role.roleId}>
                      <TableCell className="font-mono text-xs">{role.code}</TableCell>
                      <TableCell className="font-medium">{role.name}</TableCell>
                      <TableCell>
                        <StatusBadge tone={role.status === "ACTIVE" ? "success" : "neutral"}>
                          {role.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-xs text-[var(--fm-text-muted)]">
                        {role.capabilityCodes.length} capabilities
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/admin/staff/roles/${role.roleId}`}
                          className="text-xs font-medium text-[var(--fm-info)] underline"
                        >
                          {role.status === "ACTIVE" ? "Edit" : "View"}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <AdminCursorPagination
              pageNumber={pagination.pageNumber}
              nextCursor={state.page.nextCursor}
              onPrevious={pagination.previous}
              onNext={pagination.next}
            />
          </ListPageSection>
        </>
      ) : null}
    </div>
  );
}
