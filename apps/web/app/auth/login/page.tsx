import { FreshMarketsAuthProvider } from "../../../components/auth/freshmarkets-auth-provider";
import { SignIn } from "../../../components/auth/sign-in";
import { resolveAuthRedirectPath } from "../../../lib/auth/redirect";

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
    <main className="fm-storefront flex min-h-screen items-center justify-center bg-[var(--fm-surface-soft)] px-4 py-10">
      <FreshMarketsAuthProvider redirectTo={redirectTo}>
        <SignIn socialLayout="vertical" socialPosition="bottom" />
      </FreshMarketsAuthProvider>
    </main>
  );
}
