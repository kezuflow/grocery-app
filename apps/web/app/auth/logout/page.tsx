"use client";

import { useState } from "react";

export default function LogoutPage() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Sign out failed");
      setComplete(true);
      setStatus("You are signed out.");
    } catch {
      setStatus("Sign out could not be confirmed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <h1 className="text-3xl font-semibold">Sign out</h1>
      <button
        type="button"
        onClick={logout}
        disabled={busy || complete}
        className="w-fit rounded bg-slate-950 px-4 py-2 text-sm font-medium text-white"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {status ? (
        <p role="status" className="text-sm text-slate-600">
          {status}
        </p>
      ) : null}
    </main>
  );
}
