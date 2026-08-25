import Link from "next/link";
import { AuthForm } from "../auth-form";

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <h1 className="text-3xl font-semibold">Create your account</h1>
      <AuthForm mode="register" />
      <p className="text-sm">
        <Link href="/auth/login" className="underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
