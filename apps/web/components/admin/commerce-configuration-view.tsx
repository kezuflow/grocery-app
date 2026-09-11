"use client";

import { useState, type FormEvent } from "react";
import type { MembershipPriceConfigurationView } from "@freshmarkets/contracts";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { EditorLayout } from "./admin-compositions";
import { StatusBadge } from "./admin-shell";

export type MembershipPriceReplacement = {
  amountMinor: number;
  currency: string;
  effectiveFrom: string;
  reason: string;
};

type Props = {
  membership: MembershipPriceConfigurationView;
  scheduledMembership?: MembershipPriceConfigurationView | null;
  canManageMembership: boolean;
  pending?: boolean;
  onMembershipSubmit: (replacement: MembershipPriceReplacement) => void;
};

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(value / 100);
}

export function CommerceConfigurationView({
  membership,
  scheduledMembership,
  canManageMembership,
  pending = false,
  onMembershipSubmit,
}: Props) {
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onMembershipSubmit({
      amountMinor: Number(form.get("amountMinor")),
      currency: membership.currency,
      effectiveFrom: new Date(effectiveFrom).toISOString(),
      reason: reason.trim(),
    });
  }

  return (
    <EditorLayout
      asideLabel="Membership price safeguards"
      editor={
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Membership price</CardTitle>
              <CardDescription>
                Authoritative global configuration currently in effect.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge>Version {membership.version}</StatusBadge>
                <code className="text-xs text-[var(--fm-text-muted)]">
                  {membership.priceVersionId}
                </code>
              </div>
              <p className="text-3xl font-semibold">
                {money(membership.amountMinor, membership.currency)}
              </p>
              <p className="text-sm text-[var(--fm-text-muted)]">Offer {membership.offerId}</p>
              <p className="text-xs text-[var(--fm-text-muted)]">
                Effective from {new Date(membership.effectiveFrom).toLocaleString("en-PH")}
              </p>
            </CardContent>
          </Card>

          {scheduledMembership ? (
            <Card>
              <CardHeader>
                <CardTitle>Scheduled replacement</CardTitle>
                <CardDescription>
                  Version {scheduledMembership.version} becomes effective on{" "}
                  {new Date(scheduledMembership.effectiveFrom).toLocaleString("en-PH")}.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">
                {money(scheduledMembership.amountMinor, scheduledMembership.currency)}
              </CardContent>
            </Card>
          ) : null}

          {canManageMembership && !scheduledMembership && !membership.effectiveTo ? (
            <Card>
              <CardHeader>
                <CardTitle>Replace membership price</CardTitle>
                <CardDescription>
                  Create the next version; history remains immutable.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="grid gap-4" onSubmit={submit}>
                  <div className="grid gap-2">
                    <Label htmlFor="membership-amount">
                      Amount in minor units ({membership.currency})
                    </Label>
                    <Input
                      id="membership-amount"
                      name="amountMinor"
                      defaultValue={membership.amountMinor}
                      min="1"
                      required
                      type="number"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="membership-effective">Replacement effective from</Label>
                    <Input
                      id="membership-effective"
                      required
                      type="datetime-local"
                      value={effectiveFrom}
                      onChange={(event) => setEffectiveFrom(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="membership-reason">Reason for change</Label>
                    <Textarea
                      id="membership-reason"
                      className="min-h-24 bg-[var(--fm-admin-surface)]"
                      required
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </div>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={confirmed}
                      className="mt-0.5 data-[state=checked]:border-[var(--fm-admin-accent)] data-[state=checked]:bg-[var(--fm-admin-accent)]"
                      onCheckedChange={(value) => setConfirmed(value === true)}
                    />
                    <span>
                      I confirm this creates a new effective-dated version and does not edit
                      history.
                    </span>
                  </label>
                  <Button disabled={pending || !confirmed || !effectiveFrom || !reason.trim()}>
                    {pending ? "Replacing…" : "Create replacement version"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6 text-sm text-[var(--fm-text-muted)]">
                {scheduledMembership || membership.effectiveTo
                  ? "A replacement is already scheduled."
                  : "Membership management permission is required to create a replacement."}
              </CardContent>
            </Card>
          )}
        </div>
      }
      aside={
        <Card>
          <CardHeader>
            <CardTitle>Impact and audit context</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-[var(--fm-text-muted)]">
            <p>
              Existing paid subscriptions retain their snapshotted price. Replacements apply only to
              new paid subscriptions unless a separate migration is authorized.
            </p>
            <p>
              The introductory trial remains a Promotion grant over paid membership; it is not a
              zero-price plan.
            </p>
            <p>
              Accepted replacements record immutable audit evidence. Concurrent changes are rejected
              and require a refresh.
            </p>
          </CardContent>
        </Card>
      }
    />
  );
}
