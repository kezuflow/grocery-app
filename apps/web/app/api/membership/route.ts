import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

// Canonical paid membership facts. There is no free plan and no fixed-day
// trial: the introductory promotion is exactly one calendar month.
const PAID_OFFER = {
  code: "MEMBERSHIP_MONTHLY",
  name: "FreshMarkets Membership",
  amountMinor: 29900,
  currency: "PHP",
  billingInterval: "CALENDAR_MONTH",
} as const;

const INTRODUCTORY_TRIAL = {
  benefitCode: "INTRO_TRIAL",
  duration: "CALENDAR_MONTH",
} as const;

export async function GET(request: Request): Promise<Response> {
  const core = coreClient(env.CORE);
  const eligibility = await core.getSubscriptionEligibility({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
  });
  return Response.json({
    ok: true,
    value: {
      offer: PAID_OFFER,
      introductoryTrial: INTRODUCTORY_TRIAL,
      cancellationOptions: ["IMMEDIATE", "PERIOD_END"],
      subscriptionState: eligibility.ok ? eligibility.value.state : null,
    },
  });
}
