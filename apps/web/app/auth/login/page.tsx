import { FreshMarketsAuthProvider } from "../../../components/auth/freshmarkets-auth-provider";
import { SignIn } from "../../../components/auth/sign-in";

export default function LoginPage() {
  return (
    <main className="fm-storefront flex min-h-screen items-center justify-center bg-[var(--fm-surface-soft)] px-4 py-10">
      <FreshMarketsAuthProvider>
        <SignIn socialLayout="vertical" socialPosition="bottom" />
      </FreshMarketsAuthProvider>
    </main>
  );
}
