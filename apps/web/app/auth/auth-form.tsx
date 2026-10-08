"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../../components/ui/field";
import { Input } from "../../components/ui/input";

type Mode = "register" | "forgot";

export function AuthForm({ mode }: { mode: Mode }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus("");
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const path = mode === "register" ? "sign-up/email" : "request-password-reset";
    const body =
      mode === "register"
        ? { name: data.name, email: data.email, password: data.password }
        : { email: data.email, redirectTo: "/auth/reset-password" };
    try {
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
      setStatus(
        response.ok
          ? mode === "forgot"
            ? "Reset instructions requested."
            : "Request completed."
          : (payload?.message ?? payload?.error ?? "Request failed."),
      );
    } catch {
      setStatus("Your request could not be confirmed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full fm-login-card">
      <CardContent>
        <form onSubmit={submit}>
          <FieldGroup>
            {mode === "register" ? (
              <Field>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input id="name" name="name" autoComplete="name" required />
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </Field>
            {mode === "register" ? (
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </Field>
            ) : null}
            <Button type="submit" disabled={busy}>
              {busy
                ? "Working..."
                : mode === "register"
                  ? "Create account"
                  : "Send reset instructions"}
            </Button>
            {status ? (
              <p role="status" className="text-sm text-[var(--fm-text-muted)]">
                {status}
              </p>
            ) : null}
          </FieldGroup>
        </form>
        <div className="flex flex-col gap-3 items-center w-full mt-4">
          <FieldDescription className="text-center">
            <Link href="/auth/login" className="underline underline-offset-4">
              {mode === "register" ? "Log in" : "Back to log in"}
            </Link>
          </FieldDescription>
        </div>
      </CardContent>
    </Card>
  );
}
