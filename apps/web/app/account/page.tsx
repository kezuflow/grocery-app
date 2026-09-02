"use client";

import type { MembershipExperienceView } from "@freshmarkets/contracts";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { StorefrontShell } from "../../components/storefront/storefront-shell";

const PENDING_AUTHORIZATION_KEY = "freshmarkets.pendingAuthorization";

type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

type MembershipAction =
  | "AUTHORIZE"
  | "START_TRIAL"
  | "BEGIN_PAID_ENROLLMENT"
  | "PAUSE"
  | "RESUME"
  | "CANCEL_IMMEDIATELY"
  | "CANCEL_AT_PERIOD_END";

function formatOffer(experience: MembershipExperienceView): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: experience.offer.currency,
  }).format(experience.offer.amountMinor / 100);
}

export function MembershipExperiencePanel({
  experience,
  busy,
  onAction,
}: {
  experience: MembershipExperienceView;
  busy: boolean;
  onAction: (action: MembershipAction) => void;
}) {
  const action = experience.actions;
  return (
    <section className="rounded-lg border bg-white p-6" aria-labelledby="membership-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="membership-heading" className="font-semibold">
            {experience.offer.name}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {formatOffer(experience)} per calendar month
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">
          {experience.subscription?.state ?? "NOT ENROLLED"}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Introductory trial</dt>
          <dd className="font-medium">
            {experience.introductoryTrial.status.replaceAll("_", " ")}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Paid membership payment setup</dt>
          <dd className="font-medium">
            {experience.subscription?.state === "TRIALING"
              ? "Not needed during free trial"
              : experience.recurringAuthorization.status}
          </dd>
        </div>
        {experience.subscription?.trialEndsAt ? (
          <div>
            <dt className="text-slate-500">Trial ends</dt>
            <dd className="font-medium">
              {new Date(experience.subscription.trialEndsAt).toLocaleDateString("en-PH")}
            </dd>
          </div>
        ) : null}
        {experience.subscription?.scheduledCancellationAt ? (
          <div>
            <dt className="text-slate-500">Scheduled cancellation</dt>
            <dd className="font-medium">
              {new Date(experience.subscription.scheduledCancellationAt).toLocaleDateString(
                "en-PH",
              )}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-5 flex flex-wrap gap-2">
        {!experience.recurringAuthorization.ready && action.beginPaidEnrollment.available ? (
          <button
            type="button"
            onClick={() => onAction("AUTHORIZE")}
            disabled={busy}
            className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Set up paid membership payment
          </button>
        ) : null}
        {action.startTrial.available ? (
          <button
            type="button"
            onClick={() => onAction("START_TRIAL")}
            disabled={busy}
            className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Start introductory trial
          </button>
        ) : null}
        {action.beginPaidEnrollment.available && experience.recurringAuthorization.ready ? (
          <button
            type="button"
            onClick={() => onAction("BEGIN_PAID_ENROLLMENT")}
            disabled={busy}
            className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Begin paid membership
          </button>
        ) : null}
        {action.pause.available ? (
          <button
            type="button"
            onClick={() => onAction("PAUSE")}
            disabled={busy}
            className="rounded border px-4 py-2 text-sm"
          >
            Pause
          </button>
        ) : null}
        {action.resume.available ? (
          <button
            type="button"
            onClick={() => onAction("RESUME")}
            disabled={busy}
            className="rounded border px-4 py-2 text-sm"
          >
            Resume
          </button>
        ) : null}
        {action.cancelAtPeriodEnd.available ? (
          <button
            type="button"
            onClick={() => onAction("CANCEL_AT_PERIOD_END")}
            disabled={busy}
            className="rounded border px-4 py-2 text-sm"
          >
            Cancel at period end
          </button>
        ) : null}
        {action.cancelImmediately.available ? (
          <button
            type="button"
            onClick={() => onAction("CANCEL_IMMEDIATELY")}
            disabled={busy}
            className="rounded border border-red-300 px-4 py-2 text-sm text-red-700"
          >
            Cancel immediately
          </button>
        ) : null}
      </div>
    </section>
  );
}

export default function AccountPage() {
  const [experience, setExperience] = useState<MembershipExperienceView | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const actionKeys = useRef(new Map<string, string>());

  const keyFor = (action: string) => {
    const existing = actionKeys.current.get(action);
    if (existing) return existing;
    const created = `membership-${action.toLowerCase()}-${crypto.randomUUID()}`;
    actionKeys.current.set(action, created);
    return created;
  };

  const loadExperience = useCallback(async () => {
    setLoading(true);
    const result = (await fetch("/api/membership").then((response) =>
      response.json(),
    )) as RpcResult<MembershipExperienceView>;
    if (result.ok) {
      setExperience(result.value);
      setMessage("");
    } else {
      setExperience(null);
      setMessage(result.error.message);
    }
    setLoading(false);
  }, []);

  const startAuthorization = useCallback(async () => {
    const begun = (await fetch("/api/membership/authorization", {
      method: "POST",
      headers: { "idempotency-key": keyFor("AUTHORIZE") },
    }).then((response) => response.json())) as RpcResult<{
      authorizationId: string;
      actionType: "REDIRECT" | "SDK" | "NONE";
      redirectUrl: string | null;
    }>;
    if (!begun.ok) throw new Error(begun.error.message);
    if (begun.value.actionType === "REDIRECT" && begun.value.redirectUrl) {
      sessionStorage.setItem(PENDING_AUTHORIZATION_KEY, begun.value.authorizationId);
      window.location.assign(begun.value.redirectUrl);
      return;
    }
    throw new Error("Recurring authorization is temporarily unavailable");
  }, []);

  useEffect(() => {
    const pending = sessionStorage.getItem(PENDING_AUTHORIZATION_KEY);
    if (!pending) {
      void loadExperience();
      return;
    }
    sessionStorage.removeItem(PENDING_AUTHORIZATION_KEY);
    setBusy(true);
    void (async () => {
      const completed = (await fetch("/api/membership/authorization/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorizationId: pending }),
      }).then((response) => response.json())) as RpcResult<{ authorizationId: string }>;
      if (!completed.ok) throw new Error(completed.error.message);
      await loadExperience();
      setMessage("Paid membership payment setup is ready. Subscribe whenever you choose.");
    })()
      .catch((error) => setMessage((error as Error).message))
      .finally(() => setBusy(false));
  }, [loadExperience]);

  async function runAction(action: MembershipAction) {
    if (!experience) return;
    setBusy(true);
    setMessage("");
    try {
      if (action === "AUTHORIZE") {
        await startAuthorization();
        return;
      }
      const headers = {
        "content-type": "application/json",
        "idempotency-key": keyFor(action),
      };
      const request =
        action === "START_TRIAL"
          ? fetch("/api/commerce/trial", { method: "POST", headers })
          : action === "BEGIN_PAID_ENROLLMENT"
            ? fetch("/api/membership/enroll", {
                method: "POST",
                headers,
                body: JSON.stringify({ offerId: experience.offer.offerId }),
              })
            : fetch(
                `/api/membership/${action === "PAUSE" ? "pause" : action === "RESUME" ? "resume" : "cancel"}`,
                {
                  method: "POST",
                  headers,
                  body: JSON.stringify({
                    expectedVersion: experience.subscription?.version,
                    ...(action.startsWith("CANCEL")
                      ? { timing: action === "CANCEL_IMMEDIATELY" ? "IMMEDIATE" : "PERIOD_END" }
                      : {}),
                  }),
                },
              );
      const result = (await request.then((response) => response.json())) as RpcResult<unknown>;
      if (!result.ok) throw new Error(result.error.message);
      actionKeys.current.delete(action);
      await loadExperience();
      setMessage("Membership updated.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <StorefrontShell>
      <div className="flex min-h-screen w-full flex-col gap-6 px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        <Link href="/" className="text-sm underline">
          Back to marketplace
        </Link>
        <h1 className="text-3xl font-semibold">Your account</h1>
        {loading ? <p role="status">Loading membership…</p> : null}
        {!loading && experience ? (
          <MembershipExperiencePanel experience={experience} busy={busy} onAction={runAction} />
        ) : null}
        {message ? (
          <p role="status" aria-live="polite" className="text-sm">
            {message}
          </p>
        ) : null}
        <Link href="/account/addresses" className="font-medium underline">
          Delivery addresses
        </Link>
        <Link href="/cart" className="font-medium underline">
          Open cart
        </Link>
        <Link href="/orders" className="font-medium underline">
          Order history
        </Link>
      </div>
    </StorefrontShell>
  );
}
