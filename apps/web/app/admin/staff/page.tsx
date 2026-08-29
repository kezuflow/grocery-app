"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AdminStaffInvitationPage, AdminStaffPage, RpcResult } from "@freshmarkets/contracts";
import { Button } from "../../../components/ui/button";
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

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready" };

function useCommand() {
  const [notice, setNotice] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const run = useCallback(async (operationId: string, url: string, body: unknown) => {
    const signature = `${operationId}:${JSON.stringify(body)}`;
    const idempotencyKey = keys.current.get(signature) ?? crypto.randomUUID();
    keys.current.set(signature, idempotencyKey);
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as RpcResult<unknown> & {
      error?: { message?: string };
    };
    setNotice(payload.ok ? "Done." : (payload.error?.message ?? "The command failed."));
    if (payload.ok) keys.current.delete(signature);
    return payload.ok;
  }, []);
  return { notice, setNotice, run };
}

export default function StaffPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [staff, setStaff] = useState<AdminStaffPage | null>(null);
  const [invitations, setInvitations] = useState<AdminStaffInvitationPage | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const { notice, setNotice, run } = useCommand();

  const load = useCallback(() => {
    setState({ phase: "loading" });
    void (async () => {
      try {
        const [staffResponse, invitationResponse] = await Promise.all([
          fetch("/api/admin/staff"),
          fetch("/api/admin/staff/invitations"),
        ]);
        const staffPayload = (await staffResponse.json()) as RpcResult<AdminStaffPage>;
        if (!staffPayload.ok) {
          setState({
            phase: "error",
            message:
              staffPayload.error.code === "FORBIDDEN"
                ? "Staff administration requires the staff.read capability with a global scope."
                : (staffPayload.error.message ?? "Staff could not be loaded."),
            requestId: staffPayload.error.requestId,
          });
          return;
        }
        const invitationPayload =
          (await invitationResponse.json()) as RpcResult<AdminStaffInvitationPage>;
        setStaff(staffPayload.value);
        setInvitations(invitationPayload.ok ? invitationPayload.value : null);
        setState({ phase: "ready" });
      } catch {
        setState({ phase: "error", message: "Network error loading staff.", requestId: null });
      }
    })();
  }, []);

  useEffect(() => load(), [load]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (inviteEmail.trim() === "" || inviteName.trim() === "") {
      setNotice("An email and display name are required.");
      return;
    }
    const ok = await run(
      `invite:${inviteEmail.trim().toLowerCase()}`,
      "/api/admin/staff/invitations",
      {
        email: inviteEmail.trim(),
        displayName: inviteName.trim(),
      },
    );
    if (ok) {
      setInviteEmail("");
      setInviteName("");
      load();
    }
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Staff & Access"
        description="Identities, invitations, roles, and scopes. Administration is global-scope only."
      />

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
            title="Invite a staff member"
            description="Invitations never collect a password."
          >
            <form className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center" onSubmit={invite}>
              <Input
                aria-label="Invitee email"
                placeholder="work email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                className="sm:w-64"
              />
              <Input
                aria-label="Invitee display name"
                placeholder="display name"
                value={inviteName}
                onChange={(event) => setInviteName(event.target.value)}
                className="sm:w-56"
              />
              <Button type="submit" size="sm">
                Send invitation
              </Button>
            </form>
            <div className="border-t border-[var(--fm-border)] p-4">
              <Input
                aria-label="Invitation revocation reason"
                placeholder="revocation reason (required)"
                value={revokeReason}
                onChange={(event) => setRevokeReason(event.target.value)}
                className="sm:w-80"
              />
            </div>
            {invitations && invitations.items.length > 0 ? (
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
                    {invitation.status === "PENDING" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (revokeReason.trim() === "") {
                            setNotice("A revocation reason is required.");
                            return;
                          }
                          void run(
                            `revoke:${invitation.invitationId}`,
                            `/api/admin/staff/invitations/${encodeURIComponent(invitation.invitationId)}/revoke`,
                            { reason: revokeReason.trim() },
                          ).then((ok) => {
                            if (ok) {
                              setRevokeReason("");
                              load();
                            }
                          });
                        }}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </ListPageSection>

          <ListPageSection title="Staff identities">
            {staff === null || staff.items.length === 0 ? (
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
                            className="text-xs font-medium text-[var(--fm-info)] underline"
                          >
                            Manage
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between border-t border-[var(--fm-border)] px-4 py-3">
                  <span className="text-xs text-[var(--fm-text-muted)]">
                    {staff.items.length} member{staff.items.length === 1 ? "" : "s"} on this page
                  </span>
                  {staff.nextCursor ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void (async () => {
                          const response = await fetch(
                            `/api/admin/staff?cursor=${encodeURIComponent(staff.nextCursor!)}`,
                          );
                          const payload = (await response.json()) as RpcResult<AdminStaffPage>;
                          if (payload.ok)
                            setStaff({
                              items: [...(staff?.items ?? []), ...payload.value.items],
                              nextCursor: payload.value.nextCursor,
                            });
                        })();
                      }}
                    >
                      Older members
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </ListPageSection>
        </>
      ) : null}
    </div>
  );
}
