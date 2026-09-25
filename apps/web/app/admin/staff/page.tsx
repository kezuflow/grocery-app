"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAdminCommand } from "../../../components/admin/use-admin-command";
import { InvitationEmailStatusText } from "../../../components/admin/invitation-email-status";
import type {
  AdminStaffInvitationPage,
  AdminStaffPage,
  AdminRolePage,
  AdminScopeOptionView,
  RpcResult,
} from "@freshmarkets/contracts";
import { Button } from "../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { PageHeader, ListPageSection, StatusBadge } from "../../../components/admin/admin-shell";
import {
  AdminConfirmationDialog,
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";
import { WorkspaceNavigation } from "../../../components/admin/workspace-navigation";
import { useAdminScopeGuard } from "../../../app/admin/admin-context-provider";
import { useAdminRouteGuard } from "../../../components/admin/use-admin-route-guard";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready" };

export default function StaffPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [staff, setStaff] = useState<AdminStaffPage | null>(null);
  const [invitations, setInvitations] = useState<AdminStaffInvitationPage | null>(null);
  const [roles, setRoles] = useState<AdminRolePage | null>(null);
  const [scopeOptions, setScopeOptions] = useState<ReadonlyArray<AdminScopeOptionView>>([]);
  const [inviteRole, setInviteRole] = useState("");
  const [inviteScope, setInviteScope] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [confirmation, setConfirmation] = useState<
    AdminStaffInvitationPage["items"][number] | null
  >(null);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [loadingMoreRoles, setLoadingMoreRoles] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [readLoading, setReadLoading] = useState(false);
  const readSequence = useRef(0);
  const confirmationTrigger = useRef<HTMLElement | null>(null);
  const inviteButton = useRef<HTMLButtonElement | null>(null);
  const staffPagination = useAdminPagination();
  const invitationPagination = useAdminPagination();
  const { notice, setNotice, run, retry, busy, uncertain } = useAdminCommand();
  const dirty = Boolean(
    inviteRole || inviteScope || inviteEmail.trim() || inviteName.trim() || revokeReason.trim(),
  );
  const locked = busy || uncertain || confirmation !== null;
  useAdminScopeGuard(dirty, locked, () => {
    setInviteRole("");
    setInviteScope("");
    setInviteEmail("");
    setInviteName("");
    setRevokeReason("");
  });
  useAdminRouteGuard(dirty, locked);

  const load = useCallback(() => {
    const sequence = ++readSequence.current;
    setReadLoading(true);
    setLoadingMoreRoles(false);
    setState((current) => (current.phase === "ready" ? current : { phase: "loading" }));
    void (async () => {
      try {
        const [staffResult, invitationResult, rolesResult, scopesResult] = await Promise.allSettled(
          [
            fetch(
              `/api/admin/staff${staffPagination.cursor ? `?cursor=${encodeURIComponent(staffPagination.cursor)}` : ""}`,
            ).then(async (response) => (await response.json()) as RpcResult<AdminStaffPage>),
            fetch(
              `/api/admin/staff/invitations${invitationPagination.cursor ? `?cursor=${encodeURIComponent(invitationPagination.cursor)}` : ""}`,
            ).then(
              async (response) => (await response.json()) as RpcResult<AdminStaffInvitationPage>,
            ),
            fetch("/api/admin/roles?limit=100").then(async (response) => {
              const payload = (await response.json()) as RpcResult<AdminRolePage>;
              if (!payload.ok) throw new Error(payload.error.message);
              return payload.value;
            }),
            fetch("/api/admin/scopes").then(
              async (response) =>
                (await response.json()) as RpcResult<ReadonlyArray<AdminScopeOptionView>>,
            ),
          ],
        );
        if (sequence !== readSequence.current) return;
        if (staffResult.status === "rejected") throw new Error("Staff read failed");
        const staffPayload = staffResult.value;
        if (!staffPayload.ok) {
          const message =
            staffPayload.error.code === "FORBIDDEN"
              ? "Staff administration requires the staff.read capability with a global scope."
              : (staffPayload.error.message ?? "Staff could not be loaded.");
          setReadError(message);
          setState((current) =>
            current.phase === "ready" && staffPayload.error.code !== "FORBIDDEN"
              ? current
              : { phase: "error", message, requestId: staffPayload.error.requestId },
          );
          return;
        }
        setReadError(null);
        const invitationPayload =
          invitationResult.status === "fulfilled" ? invitationResult.value : null;
        const rolePage = rolesResult.status === "fulfilled" ? rolesResult.value : null;
        const scopePayload = scopesResult.status === "fulfilled" ? scopesResult.value : null;
        setInvitationError(
          invitationPayload?.ok ? null : "Invitations could not be loaded. Retry read.",
        );
        setRoleError(rolePage ? null : "Role choices could not be loaded. Retry read.");
        setScopeError(scopePayload?.ok ? null : "Scope choices could not be loaded. Retry read.");
        if (rolePage) setRoles(rolePage);
        if (scopePayload?.ok) setScopeOptions(scopePayload.value);
        setStaff(staffPayload.value);
        setInvitations(invitationPayload?.ok ? invitationPayload.value : null);
        setState({ phase: "ready" });
      } catch {
        if (sequence !== readSequence.current) return;
        setReadError("Network error loading staff.");
        setState((current) =>
          current.phase === "ready"
            ? current
            : { phase: "error", message: "Network error loading staff.", requestId: null },
        );
      } finally {
        if (sequence === readSequence.current) setReadLoading(false);
      }
    })();
  }, [staffPagination.cursor, invitationPagination.cursor]);

  useEffect(() => load(), [load]);

  async function loadRemainingRoles() {
    if (!roles?.nextCursor || loadingMoreRoles) return;
    const sequence = readSequence.current;
    setLoadingMoreRoles(true);
    let cursor: string | null = roles.nextCursor;
    const items = [...roles.items];
    try {
      for (let pageNumber = 1; cursor && pageNumber < 100; pageNumber += 1) {
        const response: Response = await fetch(
          `/api/admin/roles?limit=100&cursor=${encodeURIComponent(cursor)}`,
        );
        const payload = (await response.json()) as RpcResult<AdminRolePage>;
        if (!payload.ok) throw new Error(payload.error.message);
        items.push(...payload.value.items);
        cursor = payload.value.nextCursor;
      }
      if (cursor) throw new Error("Role choices exceed the supported list size.");
      if (sequence === readSequence.current) {
        setRoles({ items, nextCursor: null });
        setRoleError(null);
      }
    } catch {
      if (sequence === readSequence.current) {
        setRoleError("Additional role choices could not be loaded. Retry read.");
      }
    } finally {
      if (sequence === readSequence.current) setLoadingMoreRoles(false);
    }
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (readError || roleError || scopeError) {
      setNotice("Role and scope choices must load before creating an invitation.");
      return;
    }
    if (inviteEmail.trim() === "" || inviteName.trim() === "" || !inviteRole || !inviteScope) {
      setNotice("Email, display name, role and scope are required.");
      return;
    }
    readSequence.current += 1;
    setReadLoading(false);
    const ok = await run(
      `invite:${inviteEmail.trim().toLowerCase()}`,
      "/api/admin/staff/invitations",
      {
        email: inviteEmail.trim(),
        displayName: inviteName.trim(),
        roleIds: [inviteRole],
        scopes: [
          inviteScope === "global"
            ? { kind: "global" }
            : { kind: "location", locationId: inviteScope },
        ],
      },
      "POST",
      { title: "Staff invitation created" },
    );
    if (ok) {
      setInviteEmail("");
      setInviteName("");
      setInviteRole("");
      setInviteScope("");
      load();
    }
  }

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Staff & Access"
        description="Identities, invitations, roles, and scopes. Administration is global-scope only."
      />
      <WorkspaceNavigation parentCode="staff" label="Staff administration" />

      {state.phase === "loading" ? (
        <div className="space-y-3" role="status" aria-label="Loading staff">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}

      {state.phase === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Staff could not be loaded</AlertTitle>
          <AlertDescription>
            {state.message}
            {state.requestId ? (
              <>
                <br />
                <span className="font-mono text-xs">Request reference: {state.requestId}</span>
              </>
            ) : null}
          </AlertDescription>
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={load}>
            Retry read
          </Button>
        </Alert>
      ) : null}

      {state.phase === "ready" ? (
        <>
          {readError || invitationError || roleError || scopeError ? (
            <Alert variant="destructive">
              <AlertTitle>Staff setup choices need attention</AlertTitle>
              <AlertDescription>
                {[readError, invitationError, roleError, scopeError].filter(Boolean).join(" ")}
                <Button type="button" size="sm" variant="outline" className="ml-3" onClick={load}>
                  Retry read
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {notice ? (
            <p
              role="status"
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-3 text-sm"
            >
              {notice}
            </p>
          ) : null}

          {uncertain && !confirmation ? (
            <Button
              disabled={busy}
              onClick={() =>
                void retry().then((ok) => {
                  if (ok) {
                    setInviteEmail("");
                    setInviteName("");
                    setInviteRole("");
                    setInviteScope("");
                    setRevokeReason("");
                    load();
                  }
                })
              }
            >
              Retry unconfirmed action
            </Button>
          ) : null}
          <ListPageSection
            title="Invite a staff member"
            description="Choose explicit access. An invitation email is queued; the invitee signs in with their verified email at /staff-invitation."
          >
            <form className="flex flex-wrap gap-2 p-4 sm:items-center" onSubmit={invite}>
              <Input
                aria-label="Invitee email"
                placeholder="work email"
                type="email"
                value={inviteEmail}
                disabled={busy || uncertain}
                onChange={(event) => setInviteEmail(event.target.value)}
                className="sm:w-64"
              />
              <Input
                aria-label="Invitee display name"
                placeholder="display name"
                value={inviteName}
                disabled={busy || uncertain}
                onChange={(event) => setInviteName(event.target.value)}
                className="sm:w-56"
              />
              <Select
                value={inviteRole}
                onValueChange={setInviteRole}
                onOpenChange={(open) => {
                  if (open) void loadRemainingRoles();
                }}
                disabled={busy || uncertain || Boolean(roleError)}
              >
                <SelectTrigger aria-label="Invitation role" className="w-56">
                  <SelectValue placeholder="Choose role" />
                </SelectTrigger>
                <SelectContent>
                  {roles?.items
                    .filter((role) => role.status === "ACTIVE")
                    .map((role) => (
                      <SelectItem key={role.roleId} value={role.roleId}>
                        {role.name}
                      </SelectItem>
                    ))}
                  {loadingMoreRoles ? (
                    <p role="status" className="px-2 py-1 text-xs text-[var(--fm-text-muted)]">
                      Loading more roles…
                    </p>
                  ) : null}
                </SelectContent>
              </Select>
              <Select
                value={inviteScope}
                onValueChange={setInviteScope}
                disabled={busy || uncertain || Boolean(scopeError)}
              >
                <SelectTrigger aria-label="Invitation scope" className="w-56">
                  <SelectValue placeholder="Choose scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global</SelectItem>
                  {scopeOptions
                    .filter((scope) => scope.kind === "location")
                    .map((scope) =>
                      scope.kind === "location" ? (
                        <SelectItem key={scope.locationId} value={scope.locationId}>
                          {scope.locationName}
                        </SelectItem>
                      ) : null,
                    )}
                </SelectContent>
              </Select>
              <Button
                type="submit"
                size="sm"
                ref={inviteButton}
                disabled={busy || uncertain || Boolean(readError || roleError || scopeError)}
              >
                Create invitation
              </Button>
            </form>
            <div className="border-t border-[var(--fm-border)] p-4">
              <Input
                aria-label="Invitation revocation reason"
                placeholder="revocation reason (required)"
                value={revokeReason}
                disabled={busy || uncertain}
                onChange={(event) => setRevokeReason(event.target.value)}
                className="sm:w-80"
              />
            </div>
            {readLoading ? (
              <p className="border-t border-[var(--fm-border)] p-4 text-sm" role="status">
                Loading invitation page…
              </p>
            ) : readError || invitationError ? (
              <p className="border-t border-[var(--fm-border)] p-4 text-sm" role="status">
                Invitations for this page are unavailable. Retry the read or return to the previous
                page.
              </p>
            ) : invitations && invitations.items.length > 0 ? (
              <ul className="divide-y divide-[var(--fm-border)] border-t border-[var(--fm-border)]">
                {invitations.items.map((invitation) => (
                  <li
                    key={invitation.invitationId}
                    className="flex flex-wrap items-center gap-3 px-4 py-3"
                  >
                    <span className="text-sm">{invitation.displayName}</span>
                    <span className="font-mono text-xs text-[var(--fm-text-muted)]">
                      {invitation.email}
                    </span>
                    <StatusBadge tone={invitation.status === "PENDING" ? "info" : "neutral"}>
                      {invitation.status}
                    </StatusBadge>
                    <span className="ml-auto text-xs text-[var(--fm-text-muted)]">
                      expires {new Date(invitation.expiresAt).toISOString().slice(0, 10)}
                    </span>
                    <InvitationEmailStatusText status={invitation.emailStatus} />
                    {invitation.status === "PENDING" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || uncertain || Boolean(readError)}
                        onClick={(event) => {
                          confirmationTrigger.current = event.currentTarget;
                          setConfirmation(invitation);
                        }}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-t border-[var(--fm-border)] p-4 text-sm text-[var(--fm-text-muted)]">
                No invitations on this page.
              </p>
            )}
            {invitations || invitationPagination.pageNumber > 1 ? (
              <AdminCursorPagination
                pageNumber={invitationPagination.pageNumber}
                nextCursor={readError || invitationError ? null : (invitations?.nextCursor ?? null)}
                pending={locked || readLoading}
                onPrevious={invitationPagination.previous}
                onNext={invitationPagination.next}
              />
            ) : null}
          </ListPageSection>

          <ListPageSection title="Staff identities">
            {readLoading ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
                Loading staff page…
              </p>
            ) : readError ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
                Staff identities for this page are unavailable. Retry the read or return to the
                previous page.
              </p>
            ) : staff === null || staff.items.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
                No staff identities are visible to you yet.
              </p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead>Scopes</TableHead>
                      <TableHead>
                        <span className="sr-only">Detail link</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {staff.items.map((member) => (
                      <TableRow key={member.staffId}>
                        <TableCell className="font-medium">{member.displayName}</TableCell>
                        <TableCell className="font-mono text-xs">{member.email}</TableCell>
                        <TableCell>
                          <StatusBadge tone={member.status === "active" ? "success" : "warning"}>
                            {member.status}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {member.roleCodes.join(", ") || "—"}
                        </TableCell>
                        <TableCell className="text-xs text-[var(--fm-text-muted)]">
                          {member.scopes.some((scope) => scope.kind === "global")
                            ? "Global"
                            : `${member.scopes.length} scoped`}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/admin/staff/${member.staffId}`}
                            prefetch={false}
                            className="text-xs font-medium text-[var(--fm-info)] underline"
                          >
                            Manage
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
            {staff ? (
              <AdminCursorPagination
                pageNumber={staffPagination.pageNumber}
                nextCursor={readError ? null : staff.nextCursor}
                pending={locked || readLoading}
                onPrevious={staffPagination.previous}
                onNext={staffPagination.next}
              />
            ) : null}
          </ListPageSection>
        </>
      ) : null}
      <AdminConfirmationDialog
        open={confirmation !== null}
        title="Revoke this invitation?"
        resource={confirmation?.displayName ?? "Invitation"}
        scope="Global"
        consequence="The pending invitation will no longer be accepted. This action is audited."
        initialReason={revokeReason}
        reasonLocked={uncertain}
        pending={busy}
        cancelDisabled={uncertain}
        restoreFocusRef={confirmationTrigger}
        error={confirmation && notice && notice !== "Done." ? notice : undefined}
        confirmLabel={uncertain ? "Retry unconfirmed action" : "Revoke invitation"}
        onCancel={() => {
          if (!uncertain) setConfirmation(null);
        }}
        onConfirm={(reason) => {
          if (!confirmation) return;
          if (uncertain) {
            void retry().then((ok) => {
              if (ok) {
                confirmationTrigger.current = inviteButton.current;
                setConfirmation(null);
                setRevokeReason("");
                load();
              }
            });
            return;
          }
          readSequence.current += 1;
          setReadLoading(false);
          void run(
            `revoke:${confirmation.invitationId}`,
            `/api/admin/staff/invitations/${encodeURIComponent(confirmation.invitationId)}/revoke`,
            { reason, expectedVersion: confirmation.version },
            "POST",
            { title: "Staff invitation revoked" },
          ).then((ok) => {
            if (ok) {
              confirmationTrigger.current = inviteButton.current;
              setConfirmation(null);
              setRevokeReason("");
              load();
            }
          });
        }}
      />
    </div>
  );
}
