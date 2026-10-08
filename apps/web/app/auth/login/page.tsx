import { FreshMarketsAuthProvider } from "../../../components/auth/freshmarkets-auth-provider";
import { SignIn } from "../../../components/auth/sign-in";
import { resolveAuthRedirectPath } from "../../../lib/auth/redirect";
import { AuthPage } from "../auth-page";

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
    <AuthPage title="Sign in to FreshMarkets">
      <FreshMarketsAuthProvider redirectTo={redirectTo}>
        <SignIn
          className="fm-login-card"
          hideTitle
          socialLayout="vertical"
          socialPosition="bottom"
        />
      </FreshMarketsAuthProvider>
    </AuthPage>
  );
}
