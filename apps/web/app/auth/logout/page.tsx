"use client";

import { useState } from "react";

export default function LogoutPage() {
  const [status, setStatus] = useState("");

  async function logout() {
    const response = await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
    });
    setStatus(response.ok ? "You are signed out." : "Unable to sign out.");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <h1 className="text-3xl font-semibold">Sign out</h1>
      <button
        type="button"
        onClick={logout}
        className="w-fit rounded bg-slate-950 px-4 py-2 text-sm font-medium text-white"
      >
        Sign out
      </button>
      {status ? (
        <p role="status" className="text-sm text-slate-600">
          {status}
        </p>
      ) : null}
    </main>
  );
}
