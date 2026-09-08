import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import Link from "next/link";
import { coreClient } from "@/lib/core-client/core";
import { CustomerInvitationPanel } from "@/components/customer-invitation-panel";

export default async function CustomerInvitationPage() {
  const incoming = await headers();
  const result = await coreClient(env.CORE).getMyCustomerInvitation({
    requestId: crypto.randomUUID(),
    headers: { cookie: incoming.get("cookie") ?? "" },
  });
  return (
    <main className="mx-auto max-w-xl space-y-6 px-4 py-12">
      <h1 className="text-3xl font-semibold">Customer invitation</h1>
      {!result.ok ? (
        <div role="status">
          <p>{result.error.message}</p>
          <Link className="underline" href="/auth/login?returnTo=/customer-invitation">
            Sign in with your invited email
          </Link>
        </div>
      ) : result.value ? (
        <CustomerInvitationPanel offer={result.value} />
      ) : (
        <p>No pending customer invitation is available for your verified email.</p>
      )}
      <Link className="underline" href="/account">
        Back to account
      </Link>
    </main>
  );
}
