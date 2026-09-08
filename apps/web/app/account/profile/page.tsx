import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import Link from "next/link";
import { coreClient } from "@/lib/core-client/core";
import { CustomerProfilePanel } from "@/components/customer-profile-panel";

export default async function CustomerProfilePage() {
  const incoming = await headers();
  const result = await coreClient(env.CORE).getMyCustomerProfile({
    headers: { cookie: incoming.get("cookie") ?? "" },
    requestId: crypto.randomUUID(),
  });
  return (
    <main className="mx-auto max-w-xl space-y-6 px-4 py-12">
      <h1 className="text-3xl font-semibold">Your preferences</h1>
      {result.ok ? (
        <CustomerProfilePanel initial={result.value} />
      ) : (
        <div role="status">
          <p>{result.error.message}</p>
          {result.error.code === "UNAUTHENTICATED" ? (
            <Link className="underline" href="/auth/login?returnTo=/account/profile">
              Sign in to your account
            </Link>
          ) : null}
        </div>
      )}
      <Link className="block underline" href="/account">
        Back to account
      </Link>
    </main>
  );
}
