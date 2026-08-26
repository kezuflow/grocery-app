# Production Provider Decisions

Status: RECORDED SELECTIONS (2026-08-26). Selected under the standing authority to choose the
implementation provider when official documentation shows a clear best fit for the approved
product requirements (`PRODUCT_FEATURE_PROGRAMS.md` Remaining Decisions 1 and 2). Canonical
domain vocabulary is unchanged: providers remain adapters behind Payments/Notifications ports.
Full research evidence (official-doc citations retrieved 2026-08-26) is summarized here;
re-verify against live vendor docs before go-live.

## Payment provider: PayMongo

**Selection rationale.** PayMongo is the only evaluated provider that verifies every hard
requirement of our Payments domain:

- HMAC-SHA256 timestamped webhook signatures (`Paymongo-Signature: t=…,te=…,li=…`) plus stable
  `evt_` event identities — a clean fit for the `(provider, providerEventId)` inbox.
- Documented `Idempotency-Key` mechanism on charge/refund creation, matching our
  client-command idempotency invariant.
- A real Subscriptions engine (plan/customer/subscription, invoice lifecycle events
  `subscription.activated/past_due/unpaid`) mapping cleanly onto the membership state machine.
- PHP-native minor units, test mode without a merchant account, plain REST over HTTP Basic auth
  (Cloudflare Workers-safe).

**Runner-up / fallback:** Xendit (stronger multi-channel provider-managed dunning, BPI_RECURRING
debit channel; weaker static-token webhooks, undocumented GET-refund-by-id, no verified
idempotency header). **Rejected:** direct Maya Business integration (no documented webhook
signatures — IP allowlisting only; application-owned scheduling required); Stripe (PH not a
supported merchant country); Dragonpay (merchant onboarding now routed through Xendit).

**Recurring-mandate reality (design constraint recorded for Programs 3/5):**

- Recurring-capable authorizations exist today for **vaulted Visa/Mastercard** (Card Vaulting,
  gated feature) and, per public docs, **Maya wallet on-demand subscriptions** — the exact
  tokenization/setup semantics are undocumented and MUST be confirmed with PayMongo support in
  writing during capability activation.
- **GCash cannot hold a recurring mandate anywhere evaluated.** Consequence: introductory-trial
  activation (D2/D3: recurring-capable authorization before trial) must accept only
  mandate-capable instruments at launch (vaulted cards; Maya pending confirmation). GCash
  remains acceptable for non-recurring purchases. This is a canonical-application note, not a
  vendor mirror: Payments exposes `recurringCapable` authorization semantics; instruments map
  into it.

**Retry/dunning ownership.** PayMongo owns failed-recurring retries natively (fixed policy:
once per day, up to 3 attempts, then `unpaid`). Per D2, application-owned +1/+3/+6 retries are
therefore NOT built on top; Core observes provider outcomes and owns only grace
(`PAST_DUE`, 7 calendar days), recovery, expiry, and cancellation-during-grace through the
scheduler. If PayMongo later proves unable to own retries for the chosen instrument, the
application fallback policy from D2 activates instead.

**External go-live blockers (not code defects):** Subscriptions + Card Vaulting feature
enablement (support-gated), production API keys, webhook endpoint registration, written
confirmation of Maya-wallet subscription and setup-without-payment (`setup_intent`)
semantics — the last being the authoritative answer for whether a mandate can be established
before the free trial without synthesizing any charge (D2 invariant).

## Transactional email provider: Resend

**Selection rationale.** For launch-volume transactional email: free tier covers the launch
phase (3,000/mo); single Bearer-key REST call (`POST https://api.resend.com/emails`) is the
cleanest Workers integration; an `Idempotency-Key` send header matches repository convention;
the testing story simulates delivered/bounced/complained/suppressed addresses against live
webhooks (required by payment-failure and reminder flows); typed events with `svix-id`
dedupe and a defined retry ladder.

**Trade-off recorded:** shared-pool deliverability reputation at very low volume is
unverifiable from documentation. Mitigation: instrument bounce/complaint rates from day one and
keep the sender port thin — switching to Postmark (runner-up, transactional specialist, $15/mo)
is a one-module adapter change.

**External go-live blockers:** sending-domain DNS verification (SPF/DKIM records), production
API key secret, from-address provisioning. The Notifications adapter fails closed when
configuration is absent, exactly like the existing auth-email port.

## Binding consequences

- Program 4 implements the PayMongo adapter behind `ports/payment-provider.ts`; sandbox/test
  keys drive automated contract tests; nothing hardcodes provider vocabulary outside the
  adapter.
- Program 3 consumes PayMongo-native subscription retry behavior as the provider-native path
  sanctioned by D2; the scheduler owns grace timing, recovery verification, expiry, and
  cancellation effects.
- Program 6 builds the Notifications context on the Resend adapter behind its delivery port;
  domain events remain the only triggers.
