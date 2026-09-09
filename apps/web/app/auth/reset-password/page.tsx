"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

export default function ResetPasswordPage() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || complete) return;
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setStatus("Reset link is invalid or expired. Request a new link.");
      return;
    }
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    setBusy(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, newPassword: data.password }),
      });
      setComplete(response.ok);
      setStatus(
        response.ok
          ? "Password updated. You can now sign in."
          : "Reset link is invalid or expired. Request a new link.",
      );
    } catch {
      setStatus(
        "Your password change could not be confirmed. Try signing in with the new password or request a new reset link.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <h1 className="text-3xl font-semibold">Choose a new password</h1>
      <form
        onSubmit={submit}
        className="flex max-w-md flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <label className="flex flex-col gap-1 text-sm">
          New password
          <input
            name="password"
            type="password"
            minLength={8}
            required
            disabled={busy || complete}
            className="rounded border p-2"
          />
        </label>
        <button
          disabled={busy || complete}
          className="rounded bg-slate-950 px-4 py-2 text-sm font-medium text-white"
        >
          {busy ? "Updating password…" : "Update password"}
        </button>
        {status ? (
          <p role="status" className="text-sm text-slate-600">
            {status}
          </p>
        ) : null}
      </form>
      <Link className="underline" href="/auth/login">
        Sign in
      </Link>
      <Link className="underline" href="/auth/forgot-password">
        Request a new reset link
      </Link>
    </main>
  );
}
