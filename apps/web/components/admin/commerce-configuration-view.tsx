"use client";

import { useState, type FormEvent } from "react";
import type {
  MembershipPriceConfigurationView,
  ServiceFeeConfigurationView,
} from "@freshmarkets/contracts";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { EditorLayout, SettingsTabs } from "./admin-compositions";
import { StatusBadge } from "./admin-shell";

export type MembershipPriceReplacement = {
  amountMinor: number;
  currency: string;
  effectiveFrom: string;
  reason: string;
};

export type ServiceFeeReplacement = {
  feeType: ServiceFeeConfigurationView["feeType"];
  flatMinor: number;
  percentageBasisPoints: number;
  currency: string;
  effectiveFrom: string;
  reason: string;
};

type Props = {
  activeTab: "membership" | "service-fee";
  membership: MembershipPriceConfigurationView | null;
  serviceFee: ServiceFeeConfigurationView | null;
  scheduledMembership?: MembershipPriceConfigurationView | null;
  scheduledServiceFee?: ServiceFeeConfigurationView | null;
  canManageMembership: boolean;
  canManageServiceFee: boolean;
  pending?: boolean;
  onMembershipSubmit: (replacement: MembershipPriceReplacement) => void;
  onServiceFeeSubmit: (replacement: ServiceFeeReplacement) => void;
};

const tabs = [
  {
    id: "membership",
    label: "Membership Price",
    href: "/admin/commerce-configuration?tab=membership",
  },
  {
    id: "service-fee",
    label: "Instant Service Fee",
    href: "/admin/commerce-configuration?tab=service-fee",
  },
];

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(value / 100);
}

function CurrentConfiguration({
  title,
  version,
  identifier,
  effectiveFrom,
  effectiveTo,
  children,
}: {
  title: string;
  version: number;
  identifier: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Authoritative global configuration currently in effect.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge>Version {version}</StatusBadge>
          <code className="text-xs text-[var(--fm-text-muted)]">{identifier}</code>
        </div>
        {children}
        <p className="text-xs text-[var(--fm-text-muted)]">
          Effective from{" "}
          <time dateTime={effectiveFrom}>{new Date(effectiveFrom).toLocaleString("en-PH")}</time>
        </p>
        {effectiveTo ? (
          <p className="text-xs font-medium text-[var(--fm-warning-text)]">
            Scheduled to end{" "}
            <time dateTime={effectiveTo}>{new Date(effectiveTo).toLocaleString("en-PH")}</time>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ChangeAssurance({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Impact and audit context</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-[var(--fm-text-muted)]">
        {children}
        <p>
          An accepted replacement records the operator, reason, before and after values, request
          correlation, and idempotency key in an immutable audit event.
        </p>
        <p>Concurrent changes are rejected. Refresh the current version before retrying.</p>
      </CardContent>
    </Card>
  );
}

function Confirmation({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <Checkbox
        checked={checked}
        className="mt-0.5 data-[state=checked]:border-[var(--fm-admin-accent)] data-[state=checked]:bg-[var(--fm-admin-accent)]"
        onCheckedChange={(value) => onChange(value === true)}
      />
      <span>I confirm this creates a new effective-dated version and does not edit history.</span>
    </label>
  );
}

function MembershipPanel({
  config,
  scheduled,
  canManage,
  pending,
  onSubmit,
}: {
  config: MembershipPriceConfigurationView;
  scheduled?: MembershipPriceConfigurationView | null;
  canManage: boolean;
  pending: boolean;
  onSubmit: Props["onMembershipSubmit"];
}) {
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      amountMinor: Number(form.get("amountMinor")),
      currency: config.currency,
      effectiveFrom: new Date(effectiveFrom).toISOString(),
      reason: reason.trim(),
    });
  }
  return (
    <EditorLayout
      asideLabel="Membership price safeguards"
      editor={
        <div className="space-y-4">
          <CurrentConfiguration
            title="Membership Price"
            version={config.version}
            identifier={config.priceVersionId}
            effectiveFrom={config.effectiveFrom}
            effectiveTo={config.effectiveTo}
          >
            <p className="text-3xl font-semibold">{money(config.amountMinor, config.currency)}</p>
            <p className="text-sm text-[var(--fm-text-muted)]">Offer {config.offerId}</p>
          </CurrentConfiguration>
          {scheduled ? (
            <Card>
              <CardHeader>
                <CardTitle>Scheduled replacement</CardTitle>
                <CardDescription>
                  Version {scheduled.version} becomes effective on{" "}
                  <time dateTime={scheduled.effectiveFrom}>
                    {new Date(scheduled.effectiveFrom).toLocaleString("en-PH")}
                  </time>
                  .
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">
                  {money(scheduled.amountMinor, scheduled.currency)}
                </p>
              </CardContent>
            </Card>
          ) : null}
          {canManage && !scheduled && !config.effectiveTo ? (
            <Card>
              <CardHeader>
                <CardTitle>Replace Membership Price</CardTitle>
                <CardDescription>
                  Create the next version; the current record remains immutable.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="grid gap-4" onSubmit={submit}>
                  <div className="grid gap-2">
                    <Label htmlFor="membership-amount">
                      Amount in minor units ({config.currency})
                    </Label>
                    <Input
                      id="membership-amount"
                      name="amountMinor"
                      defaultValue={config.amountMinor}
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
                      className="min-h-24 bg-white"
                      required
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </div>
                  <Confirmation checked={confirmed} onChange={setConfirmed} />
                  <Button
                    disabled={pending || !confirmed || !effectiveFrom || !reason.trim()}
                    type="submit"
                  >
                    {pending ? "Replacing…" : "Create replacement version"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6 text-sm text-[var(--fm-text-muted)]">
                <strong className="text-[var(--fm-text)]">
                  {scheduled || config.effectiveTo
                    ? "A replacement is already scheduled."
                    : "Read-only access."}
                </strong>{" "}
                {scheduled || config.effectiveTo
                  ? "Wait for the scheduled version to become effective before proposing another replacement."
                  : "Membership management permission is required to create a replacement."}
              </CardContent>
            </Card>
          )}
        </div>
      }
      aside={
        <ChangeAssurance>
          <p>
            Existing subscriptions retain their snapshotted price. The replacement applies only to
            new subscriptions unless a separately authorized migration occurs.
          </p>
          <p>
            The introductory trial remains a Promotion grant over the paid membership; it is never a
            zero-price plan.
          </p>
        </ChangeAssurance>
      }
    />
  );
}

function ServiceFeePanel({
  config,
  scheduled,
  canManage,
  pending,
  onSubmit,
}: {
  config: ServiceFeeConfigurationView;
  scheduled?: ServiceFeeConfigurationView | null;
  canManage: boolean;
  pending: boolean;
  onSubmit: Props["onServiceFeeSubmit"];
}) {
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [feeType, setFeeType] = useState<ServiceFeeConfigurationView["feeType"]>(config.feeType);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      feeType,
      flatMinor: Number(form.get("flatMinor")),
      percentageBasisPoints: Number(form.get("percentageBasisPoints")),
      currency: config.currency,
      effectiveFrom: new Date(effectiveFrom).toISOString(),
      reason: reason.trim(),
    });
  }
  return (
    <EditorLayout
      asideLabel="Service Fee safeguards"
      editor={
        <div className="space-y-4">
          <CurrentConfiguration
            title="Instant Service Fee"
            version={config.version}
            identifier={config.configurationId}
            effectiveFrom={config.effectiveFrom}
            effectiveTo={config.effectiveTo}
          >
            <div className="flex flex-wrap items-baseline gap-3">
              <StatusBadge>{config.feeType}</StatusBadge>
              <span className="text-xl font-semibold">
                {money(config.flatMinor, config.currency)} flat
              </span>
              <span className="text-sm text-[var(--fm-text-muted)]">
                {(config.percentageBasisPoints / 100).toFixed(2)}%
              </span>
            </div>
            <p className="text-sm text-[var(--fm-text-muted)]">Current reason: {config.reason}</p>
          </CurrentConfiguration>
          {scheduled ? (
            <Card>
              <CardHeader>
                <CardTitle>Scheduled replacement</CardTitle>
                <CardDescription>
                  Version {scheduled.version} becomes effective on{" "}
                  <time dateTime={scheduled.effectiveFrom}>
                    {new Date(scheduled.effectiveFrom).toLocaleString("en-PH")}
                  </time>
                  .
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <StatusBadge>{scheduled.feeType}</StatusBadge>
                <span>{money(scheduled.flatMinor, scheduled.currency)} flat</span>
                <span>{(scheduled.percentageBasisPoints / 100).toFixed(2)}%</span>
              </CardContent>
            </Card>
          ) : null}
          {canManage && !scheduled && !config.effectiveTo ? (
            <Card>
              <CardHeader>
                <CardTitle>Replace Service Fee</CardTitle>
                <CardDescription>
                  Create the next global effective-dated configuration.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="grid gap-4" onSubmit={submit}>
                  <div className="grid gap-2">
                    <Label htmlFor="fee-type">Fee type</Label>
                    <Select
                      value={feeType}
                      onValueChange={(value) =>
                        setFeeType(value as ServiceFeeConfigurationView["feeType"])
                      }
                    >
                      <SelectTrigger className="w-full bg-white" id="fee-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FLAT">Flat</SelectItem>
                        <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                        <SelectItem value="MIXED">Mixed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="fee-flat">
                        Flat amount in minor units ({config.currency})
                      </Label>
                      <Input
                        defaultValue={config.flatMinor}
                        id="fee-flat"
                        min="0"
                        name="flatMinor"
                        required
                        type="number"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="fee-percentage">Percentage in basis points</Label>
                      <Input
                        defaultValue={config.percentageBasisPoints}
                        id="fee-percentage"
                        max="10000"
                        min="0"
                        name="percentageBasisPoints"
                        required
                        type="number"
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="fee-effective">Replacement effective from</Label>
                    <Input
                      id="fee-effective"
                      required
                      type="datetime-local"
                      value={effectiveFrom}
                      onChange={(event) => setEffectiveFrom(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="fee-reason">Reason for change</Label>
                    <Textarea
                      id="fee-reason"
                      className="min-h-24 bg-white"
                      required
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </div>
                  <Confirmation checked={confirmed} onChange={setConfirmed} />
                  <Button
                    disabled={pending || !confirmed || !effectiveFrom || !reason.trim()}
                    type="submit"
                  >
                    {pending ? "Replacing…" : "Create replacement version"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6 text-sm text-[var(--fm-text-muted)]">
                <strong className="text-[var(--fm-text)]">
                  {scheduled || config.effectiveTo
                    ? "A replacement is already scheduled."
                    : "Read-only access."}
                </strong>{" "}
                {scheduled || config.effectiveTo
                  ? "Wait for the scheduled version to become effective before proposing another replacement."
                  : "Payment management permission is required to create a replacement."}
              </CardContent>
            </Card>
          )}
        </div>
      }
      aside={
        <ChangeAssurance>
          <p>
            <strong className="text-[var(--fm-text)]">Instant orders only.</strong> Scheduled orders
            never receive the FreshMarkets Service Fee.
          </p>
          <p>
            Percentage applies to the complete payable total before the Service Fee. Mixed is flat
            plus percentage.
          </p>
          <p>
            Committed Quotes and Orders keep their snapshotted calculation; history is never
            rewritten.
          </p>
        </ChangeAssurance>
      }
    />
  );
}

export function CommerceConfigurationView(props: Props) {
  return (
    <div className="space-y-4">
      <SettingsTabs activeId={props.activeTab} label="Commerce configuration" tabs={tabs} />
      {props.activeTab === "membership" && props.membership ? (
        <MembershipPanel
          config={props.membership}
          scheduled={props.scheduledMembership}
          canManage={props.canManageMembership}
          pending={Boolean(props.pending)}
          onSubmit={props.onMembershipSubmit}
        />
      ) : null}
      {props.activeTab === "service-fee" && props.serviceFee ? (
        <ServiceFeePanel
          config={props.serviceFee}
          scheduled={props.scheduledServiceFee}
          canManage={props.canManageServiceFee}
          pending={Boolean(props.pending)}
          onSubmit={props.onServiceFeeSubmit}
        />
      ) : null}
    </div>
  );
}
