import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import Link from "next/link";
import { coreClient } from "@/lib/core-client/core";
import { StaffInvitationPanel } from "@/components/staff-invitation-panel";

export default async function StaffInvitationPage() {
  const incoming = await headers();
  const result = await coreClient(env.CORE).getMyStaffInvitation({
    requestId: crypto.randomUUID(),
    headers: { cookie: incoming.get("cookie") ?? "" },
  });
  return (
    <main className="mx-auto max-w-xl space-y-6 px-4 py-12">
      <h1 className="text-3xl font-semibold">Staff invitation</h1>
      {!result.ok ? (
        <div role="status">
          <p>{result.error.message}</p>
          <Link className="underline" href="/auth/login?returnTo=/staff-invitation">
            Sign in with your invited email
          </Link>
        </div>
      ) : result.value ? (
        <StaffInvitationPanel offer={result.value} />
      ) : (
        <p>No pending staff invitation is available for your verified email.</p>
      )}
      <Link className="underline" href="/account">
        Back to account
      </Link>
    </main>
  );
}
