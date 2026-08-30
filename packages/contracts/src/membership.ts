import type { RpcResult } from "./common";
import type { SubscriptionState } from "./states";
import type { AuthenticatedRequest } from "./auth";

export type SubscriptionEligibilityRequest = AuthenticatedRequest;
export type SubscriptionEligibility = {
  eligible: boolean;
  state: SubscriptionState | null;
  trialEndsAt: string | null;
};

/** Historical trial route request retained while callers migrate to the canonical command. */
export type StartTrialRequest = AuthenticatedRequest & { offerCode?: string };

// Canonical single paid membership offer. It intentionally carries no
// trial-entitlement field: introductory trials are Promotions grants.
export type MembershipOfferView = {
  offerId: string;
  code: string;
  name: string;
  amountMinor: number;
  currency: string;
  billingInterval: "CALENDAR_MONTH";
};

export type SubscriptionSummary = {
  subscriptionId: string;
  state: SubscriptionState;
  cancelAtPeriodEnd: boolean;
  scheduledCancellationAt: string | null;
  trialStartsAt: string | null;
  trialEndsAt: string | null;
  version: number;
};

export type MembershipActionAvailability = {
  available: boolean;
  disabledReason: string | null;
};

export type MembershipExperienceView = {
  offer: MembershipOfferView;
  subscription: SubscriptionSummary | null;
  introductoryTrial: {
    status: "AVAILABLE" | "AUTHORIZATION_REQUIRED" | "REDEEMED" | "OPEN_SUBSCRIPTION";
    eligible: boolean;
    duration: "CALENDAR_MONTH";
  };
  recurringAuthorization: {
    status: "READY" | "PENDING" | "REQUIRED";
    ready: boolean;
  };
  actions: {
    startTrial: MembershipActionAvailability;
    beginPaidEnrollment: MembershipActionAvailability;
    pause: MembershipActionAvailability;
    resume: MembershipActionAvailability;
    cancelImmediately: MembershipActionAvailability;
    cancelAtPeriodEnd: MembershipActionAvailability;
  };
};

export type GetSubscriptionRequest = AuthenticatedRequest;
export type StartPromotionalTrialRequest = AuthenticatedRequest & { idempotencyKey: string };
export type BeginPaidEnrollmentRequest = AuthenticatedRequest & {
  offerId: string;
  idempotencyKey: string;
};
export type PauseSubscriptionRequest = AuthenticatedRequest & {
  reason?: string;
  idempotencyKey: string;
  expectedVersion: number;
};
export type ResumeSubscriptionRequest = AuthenticatedRequest & {
  idempotencyKey: string;
  expectedVersion: number;
};
export type CancelSubscriptionRequest = AuthenticatedRequest & {
  timing: "IMMEDIATE" | "PERIOD_END";
  reason?: string;
  idempotencyKey: string;
  expectedVersion: number;
};

/**
 * Canonical membership target port. Provider references never appear here;
 * payment interaction belongs to PaymentsService. Lifecycle commands carry a
 * stable idempotency key and the required aggregate version.
 */
export type MembershipService = {
  getMembershipExperience(
    request: AuthenticatedRequest,
  ): Promise<RpcResult<MembershipExperienceView>>;
  getSubscriptionEligibility(
    request: SubscriptionEligibilityRequest | GetSubscriptionRequest,
  ): Promise<RpcResult<SubscriptionEligibility>>;
  getSubscriptionSummary(request: AuthenticatedRequest): Promise<RpcResult<SubscriptionSummary>>;
  getOffer(request: AuthenticatedRequest): Promise<RpcResult<MembershipOfferView>>;
  startTrial(request: StartPromotionalTrialRequest): Promise<RpcResult<SubscriptionSummary>>;
  beginPaidEnrollment(request: BeginPaidEnrollmentRequest): Promise<RpcResult<SubscriptionSummary>>;
  pauseSubscription(request: PauseSubscriptionRequest): Promise<RpcResult<SubscriptionSummary>>;
  resumeSubscription(request: ResumeSubscriptionRequest): Promise<RpcResult<SubscriptionSummary>>;
  cancelSubscription(request: CancelSubscriptionRequest): Promise<RpcResult<SubscriptionSummary>>;
};
