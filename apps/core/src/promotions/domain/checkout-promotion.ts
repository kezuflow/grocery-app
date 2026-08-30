export type PromotionCheckoutContext = {
  customerId: string;
  marketId: string;
  locationId: string;
  fulfillmentMode: "INSTANT" | "SCHEDULED";
  merchandiseSubtotalMinor: number;
  deliverySubtotalMinor: number;
  lineFacts: ReadonlyArray<{
    skuId: string;
    productId: string;
    categoryId: string;
    quantity: number;
    lineSubtotalMinor: number;
  }>;
  requestedCodes: readonly string[];
  at: number;
};

export type PromotionEligibilityFacts = {
  firstOrder: boolean;
  newCustomer: boolean;
  member: boolean;
  segmentIds: readonly string[];
};

export type CheckoutPromotionRule = {
  type:
    | "FIRST_ORDER"
    | "NEW_CUSTOMER"
    | "MEMBER"
    | "NON_MEMBER"
    | "MINIMUM_SUBTOTAL"
    | "CUSTOMER_SEGMENT"
    | "SPECIFIC_CUSTOMERS";
  parameters: Readonly<Record<string, unknown>>;
};

export type CheckoutPromotionCandidate = {
  id: string;
  code: string;
  name: string;
  status: string;
  startsAt: number;
  endsAt: number | null;
  globalUsageLimit: number | null;
  perCustomerUsageLimit: number | null;
  globalUsageCount: number;
  customerUsageCount: number;
  automatic: boolean;
  priority: number;
  version: number;
  grant: { id: string; maxRedemptions: number; redemptionCount: number } | null;
  benefit: {
    type:
      | "ORDER_FIXED_DISCOUNT"
      | "ORDER_PERCENT_DISCOUNT"
      | "DELIVERY_FEE_WAIVER"
      | "DELIVERY_FEE_DISCOUNT";
    discountMinor: number | null;
    percent: number | null;
    maximumDiscountMinor: number | null;
  };
  rules: readonly CheckoutPromotionRule[];
};

export type CheckoutPromotionApplication = {
  promotionId: string;
  code: string;
  name: string;
  component: "MERCHANDISE" | "DELIVERY";
  benefitType: CheckoutPromotionCandidate["benefit"]["type"];
  amountMinor: number;
  automatic: boolean;
  definitionVersion: number;
  grantId: string | null;
  snapshot: Readonly<Record<string, unknown>>;
};

export type PromotionCodeFeedback = {
  code: string;
  status: "APPLIED" | "INVALID" | "EXPIRED" | "INELIGIBLE" | "DUPLICATE" | "NOT_SELECTED";
  message: string;
};

type Evaluated = {
  candidate: CheckoutPromotionCandidate;
  application: CheckoutPromotionApplication | null;
  eligible: boolean;
  reason: "EXPIRED" | "INELIGIBLE" | null;
};

function ruleMatches(
  rule: CheckoutPromotionRule,
  context: PromotionCheckoutContext,
  facts: PromotionEligibilityFacts,
): boolean {
  switch (rule.type) {
    case "FIRST_ORDER":
      return facts.firstOrder;
    case "NEW_CUSTOMER":
      return facts.newCustomer;
    case "MEMBER":
      return facts.member;
    case "NON_MEMBER":
      return !facts.member;
    case "MINIMUM_SUBTOTAL":
      return (
        Number.isSafeInteger(rule.parameters.minimumMinor) &&
        context.merchandiseSubtotalMinor >= Number(rule.parameters.minimumMinor)
      );
    case "CUSTOMER_SEGMENT":
      return (
        typeof rule.parameters.segmentId === "string" &&
        facts.segmentIds.includes(rule.parameters.segmentId)
      );
    case "SPECIFIC_CUSTOMERS":
      return (
        Array.isArray(rule.parameters.customerIds) &&
        rule.parameters.customerIds.includes(context.customerId)
      );
  }
}

function amountFor(
  candidate: CheckoutPromotionCandidate,
  context: PromotionCheckoutContext,
): { component: "MERCHANDISE" | "DELIVERY"; amountMinor: number } {
  const type = candidate.benefit.type;
  const component = type.startsWith("DELIVERY") ? "DELIVERY" : "MERCHANDISE";
  const basis =
    component === "DELIVERY" ? context.deliverySubtotalMinor : context.merchandiseSubtotalMinor;
  let amount = 0;
  if (type === "ORDER_FIXED_DISCOUNT") amount = candidate.benefit.discountMinor ?? 0;
  else if (type === "DELIVERY_FEE_WAIVER") amount = basis;
  else amount = Math.floor((basis * (candidate.benefit.percent ?? 0)) / 100);
  if (candidate.benefit.maximumDiscountMinor !== null)
    amount = Math.min(amount, candidate.benefit.maximumDiscountMinor);
  return { component, amountMinor: Math.max(0, Math.min(basis, amount)) };
}

function evaluate(
  candidate: CheckoutPromotionCandidate,
  context: PromotionCheckoutContext,
  facts: PromotionEligibilityFacts,
): Evaluated {
  const expired =
    candidate.status !== "ACTIVE" ||
    candidate.startsAt > context.at ||
    (candidate.endsAt !== null && candidate.endsAt <= context.at);
  if (expired) return { candidate, application: null, eligible: false, reason: "EXPIRED" };
  const limitReached =
    (candidate.globalUsageLimit !== null &&
      candidate.globalUsageCount >= candidate.globalUsageLimit) ||
    (candidate.perCustomerUsageLimit !== null &&
      candidate.customerUsageCount >= candidate.perCustomerUsageLimit) ||
    (candidate.grant !== null && candidate.grant.redemptionCount >= candidate.grant.maxRedemptions);
  const explicitlyRequested = context.requestedCodes.some(
    (code) => code.trim().toUpperCase() === candidate.code.toUpperCase(),
  );
  const targetedOrAutomatic =
    candidate.automatic || candidate.grant !== null || explicitlyRequested;
  if (
    limitReached ||
    !targetedOrAutomatic ||
    !candidate.rules.every((rule) => ruleMatches(rule, context, facts))
  )
    return { candidate, application: null, eligible: false, reason: "INELIGIBLE" };
  const { component, amountMinor } = amountFor(candidate, context);
  if (amountMinor <= 0)
    return { candidate, application: null, eligible: false, reason: "INELIGIBLE" };
  return {
    candidate,
    eligible: true,
    reason: null,
    application: {
      promotionId: candidate.id,
      code: candidate.code,
      name: candidate.name,
      component,
      benefitType: candidate.benefit.type,
      amountMinor,
      automatic: candidate.automatic,
      definitionVersion: candidate.version,
      grantId: candidate.grant?.id ?? null,
      snapshot: {
        promotionId: candidate.id,
        code: candidate.code,
        name: candidate.name,
        definitionVersion: candidate.version,
        benefit: candidate.benefit,
        rules: candidate.rules,
        calculatedAmountMinor: amountMinor,
        component,
      },
    },
  };
}

export function evaluateCheckoutPromotionCandidates(
  context: PromotionCheckoutContext,
  facts: PromotionEligibilityFacts,
  candidates: readonly CheckoutPromotionCandidate[],
): { applications: CheckoutPromotionApplication[]; feedback: PromotionCodeFeedback[] } {
  const requested = context.requestedCodes.map((code) => code.trim().toUpperCase());
  const firstRequestedIndex = new Map<string, number>();
  requested.forEach((code, index) => {
    if (!firstRequestedIndex.has(code)) firstRequestedIndex.set(code, index);
  });
  const byCode = new Map(candidates.map((candidate) => [candidate.code.toUpperCase(), candidate]));
  const evaluated = new Map(
    candidates.map((candidate) => [candidate.id, evaluate(candidate, context, facts)]),
  );

  const winners: CheckoutPromotionApplication[] = [];
  for (const component of ["MERCHANDISE", "DELIVERY"] as const) {
    const explicit = [...firstRequestedIndex]
      .map(([code, index]) => ({ index, candidate: byCode.get(code) }))
      .filter(
        (entry): entry is { index: number; candidate: CheckoutPromotionCandidate } =>
          entry.candidate !== undefined,
      )
      .map((entry) => ({ index: entry.index, evaluated: evaluated.get(entry.candidate.id)! }))
      .filter(
        (entry) => entry.evaluated.eligible && entry.evaluated.application?.component === component,
      )
      .sort(
        (left, right) =>
          left.index - right.index ||
          left.evaluated.candidate.id.localeCompare(right.evaluated.candidate.id),
      );
    if (explicit[0]?.evaluated.application) {
      winners.push(explicit[0].evaluated.application);
      continue;
    }
    const fallback = [...evaluated.values()]
      .filter((entry) => entry.eligible && entry.application?.component === component)
      .sort(
        (left, right) =>
          (right.application?.amountMinor ?? 0) - (left.application?.amountMinor ?? 0) ||
          left.candidate.id.localeCompare(right.candidate.id),
      )[0];
    if (fallback?.application) winners.push(fallback.application);
  }

  const winnerIds = new Set(winners.map((winner) => winner.promotionId));
  const seen = new Set<string>();
  const feedback: PromotionCodeFeedback[] = requested.map((code) => {
    if (seen.has(code))
      return { code, status: "DUPLICATE", message: "Promotion code was entered more than once" };
    seen.add(code);
    const candidate = byCode.get(code);
    if (!candidate) return { code, status: "INVALID", message: "Promotion code was not found" };
    const result = evaluated.get(candidate.id)!;
    if (result.reason === "EXPIRED")
      return { code, status: "EXPIRED", message: "Promotion is not active" };
    if (!result.eligible)
      return { code, status: "INELIGIBLE", message: "Promotion is not eligible for this order" };
    if (winnerIds.has(candidate.id))
      return { code, status: "APPLIED", message: "Promotion applied" };
    return {
      code,
      status: "NOT_SELECTED",
      message: "Another eligible promotion provides this component's benefit",
    };
  });
  return { applications: winners, feedback };
}
