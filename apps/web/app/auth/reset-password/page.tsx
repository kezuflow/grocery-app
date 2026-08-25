"use client";

import { FormEvent, useState } from "react";

export default function ResetPasswordPage() {
  const [status, setStatus] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = new URLSearchParams(window.location.search).get("token");
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token, newPassword: data.password }),
    });
    setStatus(response.ok ? "Password updated." : "Reset link is invalid or expired.");
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
            className="rounded border p-2"
          />
        </label>
        <button className="rounded bg-slate-950 px-4 py-2 text-sm font-medium text-white">
          Update password
        </button>
        {status ? (
          <p role="status" className="text-sm text-slate-600">
            {status}
          </p>
        ) : null}
      </form>
    </main>
  );
}
