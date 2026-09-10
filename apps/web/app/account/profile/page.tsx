import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import Link from "next/link";
import { coreClient } from "@/lib/core-client/core";
import { CustomerProfilePanel, CustomerNamePanel } from "@/components/customer-profile-panel";

import { StorefrontShell } from "@/components/storefront/storefront-shell";
import "../account.css";

export default async function CustomerProfilePage() {
  const incoming = await headers();
  const result = await coreClient(env.CORE).getMyCustomerProfile({
    headers: { cookie: incoming.get("cookie") ?? "" },
    requestId: crypto.randomUUID(),
  });
  return (
    <StorefrontShell>
      <div className="fm-account-page">
        <Link href="/account" className="fm-account-back">
          ← Back to account
        </Link>
        <header className="fm-account-heading">
          <h1>Profile</h1>
          <p>Manage your account details and preferences.</p>
        </header>
        {result.ok ? (
          <>
            <section className="fm-account-panel">
              <header>
                <h2>Account details</h2>
                <Link href="/auth/forgot-password">Reset password</Link>
              </header>
              <div className="fm-account-form">
                <CustomerNamePanel />
              </div>
            </section>
            <section className="fm-account-panel">
              <header>
                <h2>Contact and preferences</h2>
              </header>
              <div className="fm-account-form">
                <CustomerProfilePanel initial={result.value} />
              </div>
            </section>
          </>
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
      </div>
    </StorefrontShell>
  );
}
