"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function RetryReadButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="mt-3 min-h-11 underline disabled:opacity-50"
    >
      {pending ? "Loading…" : "Try again"}
    </button>
  );
}
