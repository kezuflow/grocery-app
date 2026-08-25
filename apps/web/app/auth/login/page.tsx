import Link from "next/link";
import { AuthForm } from "../auth-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <h1 className="text-3xl font-semibold">Log in</h1>
      <AuthForm mode="login" />
      <p className="text-sm">
        <Link href="/auth/register" className="underline">
          Create an account
        </Link>{" "}
        ·{" "}
        <Link href="/auth/forgot-password" className="underline">
          Forgot password?
        </Link>
      </p>
    </main>
  );
}
