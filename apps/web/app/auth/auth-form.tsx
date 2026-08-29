"use client";

import { type FormEvent, useState } from "react";

type Mode = "register" | "forgot";

export function AuthForm({ mode }: { mode: Mode }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const path = mode === "register" ? "sign-up/email" : "request-password-reset";
    const body =
      mode === "register"
        ? { name: data.name, email: data.email, password: data.password }
        : { email: data.email, redirectTo: "/auth/reset-password" };
    const response = await fetch(`/api/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
      error?: string;
    } | null;
    setBusy(false);
    setStatus(
      response.ok
        ? mode === "forgot"
          ? "Reset instructions requested."
          : "Request completed."
        : (payload?.message ?? payload?.error ?? "Request failed."),
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex max-w-md flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      {mode === "register" ? (
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input name="name" required className="rounded border p-2" />
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input name="email" type="email" required className="rounded border p-2" />
      </label>
      {mode === "register" ? (
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            name="password"
            type="password"
            minLength={8}
            required
            className="rounded border p-2"
          />
        </label>
      ) : null}
      <button
        disabled={busy}
        className="rounded bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Working..." : mode === "register" ? "Create account" : "Send reset instructions"}
      </button>
      {status ? (
        <p role="status" className="text-sm text-slate-600">
          {status}
        </p>
      ) : null}
    </form>
  );
}
