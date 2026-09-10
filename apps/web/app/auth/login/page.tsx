import { FreshMarketsAuthProvider } from "../../../components/auth/freshmarkets-auth-provider";
import { SignIn } from "../../../components/auth/sign-in";
import { resolveAuthRedirectPath } from "../../../lib/auth/redirect";
import Link from "next/link";
import "./login.css";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    redirectTo?: string | string[];
    returnTo?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const redirectTo = resolveAuthRedirectPath(params.redirectTo ?? params.returnTo);

  return (
    <main className="fm-storefront fm-login-page">
      <div className="fm-login-content">
        <header className="fm-login-heading">
          <Link href="/" className="fm-login-brand" aria-label="FreshMarkets home">
            FreshMarkets<span aria-hidden="true">.</span>
          </Link>
          <h1>Sign in to FreshMarkets</h1>
        </header>
        <FreshMarketsAuthProvider redirectTo={redirectTo}>
          <SignIn
            className="fm-login-card"
            hideTitle
            socialLayout="vertical"
            socialPosition="bottom"
          />
        </FreshMarketsAuthProvider>
      </div>
    </main>
  );
}
