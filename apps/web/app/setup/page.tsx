import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import Link from "next/link";
import { coreClient } from "@/lib/core-client/core";
import { InitialAdministratorPanel } from "@/components/initial-administrator-panel";

export default async function SetupPage() {
  const incoming = await headers();
  const result = await coreClient(env.CORE).getInitialAdministratorSetup({
    requestId: crypto.randomUUID(),
    headers: { cookie: incoming.get("cookie") ?? "" },
  });
  return (
    <main className="mx-auto max-w-xl space-y-6 px-4 py-12">
      <h1 className="text-3xl font-semibold">Administrator setup</h1>
      {!result.ok ? (
        <div role="status">
          <p>{result.error.message}</p>
          <Link className="underline" href="/auth/login?returnTo=/setup">
            Sign in to continue
          </Link>
        </div>
      ) : result.value.state === "READY" ? (
        <InitialAdministratorPanel expectedVersion={result.value.expectedVersion} />
      ) : result.value.state === "COMPLETED" ? (
        <div>
          <p>Your initial administrator setup is complete.</p>
          <Link className="underline" href="/admin">
            Open Admin
          </Link>
        </div>
      ) : result.value.state === "VERIFY_EMAIL" ? (
        <p role="status">Verify your sign-in email, then return to this page.</p>
      ) : (
        <p role="status">
          Initial setup is unavailable for this account or has already been completed. Ask your
          administrator for a staff invitation.
        </p>
      )}
      <Link className="underline" href="/account">
        Back to account
      </Link>
    </main>
  );
}
