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

/** Fields used by the current closed eligibility rules; no invented fulfillment facts in Admin previews. */
export type PromotionEvaluationContext = Pick<
  PromotionCheckoutContext,
  "customerId" | "merchandiseSubtotalMinor" | "deliverySubtotalMinor" | "requestedCodes" | "at"
> &
  Partial<Pick<PromotionCheckoutContext, "locationId" | "fulfillmentMode" | "lineFacts">> & {
    discountableSubtotalMinor?: number;
    quoteId?: string;
    cartId?: string;
  };

export type PromotionEligibilityFacts = {
  firstOrder: boolean;
  newCustomer: boolean;
  segmentIds: readonly string[];
};

export type CheckoutPromotionRule = {
  type:
    | "FIRST_ORDER"
    | "NEW_CUSTOMER"
    | "MINIMUM_SUBTOTAL"
    | "CUSTOMER_SEGMENT"
    | "SPECIFIC_CUSTOMERS";
  parameters: Readonly<Record<string, unknown>>;
};

export type CheckoutPromotionCandidate = {
  productTargets?: readonly {
    skuId: string;
    locationId: string;
    quantityLimit: number | null;
    remainingQuantity: number | null;
  }[];
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
      | "DELIVERY_PERCENT_DISCOUNT"
      | "DELIVERY_FIXED_DISCOUNT";
    discountMinor: number | null;
    percent: number | null;
    maximumDiscountMinor: number | null;
  };
  rules: readonly CheckoutPromotionRule[];
};

export type CheckoutPromotionApplication = {
  kind?: "PRODUCT_SALE";
  lines?: readonly ProductSaleLine[];
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

export type ProductSaleLine = { skuId: string; quantity: number; amountMinor: number };

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
  context: PromotionEvaluationContext,
  facts: PromotionEligibilityFacts,
): boolean {
  switch (rule.type) {
    case "FIRST_ORDER":
      return facts.firstOrder;
    case "NEW_CUSTOMER":
      return facts.newCustomer;
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

/** Retained storage may contain unsupported vocabulary or parameters; never broaden its benefit. */
export function isPromotionBenefitValid(benefit: CheckoutPromotionCandidate["benefit"]): boolean {
  const positive = (value: number | null) =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  if (benefit.maximumDiscountMinor !== null && !positive(benefit.maximumDiscountMinor))
    return false;
  if (benefit.type === "DELIVERY_FEE_WAIVER")
    return benefit.discountMinor === null && benefit.percent === null;
  if (benefit.type === "ORDER_FIXED_DISCOUNT" || benefit.type === "DELIVERY_FIXED_DISCOUNT")
    return positive(benefit.discountMinor) && benefit.percent === null;
  if (benefit.type === "ORDER_PERCENT_DISCOUNT" || benefit.type === "DELIVERY_PERCENT_DISCOUNT")
    return (
      positive(benefit.percent) && (benefit.percent ?? 0) <= 100 && benefit.discountMinor === null
    );
  return false;
}

export function calculatePromotionDiscount(
  candidate: Pick<CheckoutPromotionCandidate, "benefit">,
  context: Pick<PromotionCheckoutContext, "merchandiseSubtotalMinor" | "deliverySubtotalMinor">,
): { component: "MERCHANDISE" | "DELIVERY"; amountMinor: number } {
  const type = candidate.benefit.type;
  const component = type.startsWith("DELIVERY") ? "DELIVERY" : "MERCHANDISE";
  const basis =
    component === "DELIVERY" ? context.deliverySubtotalMinor : context.merchandiseSubtotalMinor;
  let amount = 0;
  if (type === "ORDER_FIXED_DISCOUNT" || type === "DELIVERY_FIXED_DISCOUNT")
    amount = candidate.benefit.discountMinor ?? 0;
  else if (type === "DELIVERY_FEE_WAIVER") amount = basis;
  else amount = Number((BigInt(basis) * BigInt(candidate.benefit.percent ?? 0)) / 100n);
  if (candidate.benefit.maximumDiscountMinor !== null)
    amount = Math.min(amount, candidate.benefit.maximumDiscountMinor);
  return { component, amountMinor: Math.max(0, Math.min(basis, amount)) };
}

function evaluate(
  candidate: CheckoutPromotionCandidate,
  context: PromotionEvaluationContext,
  facts: PromotionEligibilityFacts,
): Evaluated {
  if (!isPromotionBenefitValid(candidate.benefit))
    return { candidate, application: null, eligible: false, reason: "INELIGIBLE" };
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
  const { component, amountMinor } = calculatePromotionDiscount(candidate, {
    ...context,
    merchandiseSubtotalMinor: context.discountableSubtotalMinor ?? context.merchandiseSubtotalMinor,
  });
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

function evaluateProductSale(
  candidate: CheckoutPromotionCandidate,
  context: PromotionEvaluationContext,
  facts: PromotionEligibilityFacts,
): Evaluated {
  const evaluated = evaluate(candidate, context, facts);
  if (!evaluated.application) return evaluated;
  if (evaluated.application.component !== "MERCHANDISE")
    return { ...evaluated, eligible: false, application: null, reason: "INELIGIBLE" };
  const lines: ProductSaleLine[] = [];
  for (const line of context.lineFacts ?? []) {
    const target = candidate.productTargets?.find(
      (target) => target.skuId === line.skuId && target.locationId === context.locationId,
    );
    if (
      !target ||
      (target.quantityLimit !== null &&
        (context.fulfillmentMode !== "INSTANT" ||
          target.remainingQuantity === null ||
          line.quantity > target.remainingQuantity))
    )
      continue;
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0 ||
      !Number.isSafeInteger(line.lineSubtotalMinor) ||
      line.lineSubtotalMinor <= 0
    )
      continue;
    const amountMinor =
      candidate.benefit.type === "ORDER_FIXED_DISCOUNT"
        ? Number(
            [
              BigInt(line.lineSubtotalMinor),
              BigInt(candidate.benefit.discountMinor ?? 0) * BigInt(line.quantity),
            ].reduce((a, b) => (a < b ? a : b)),
          )
        : Number((BigInt(line.lineSubtotalMinor) * BigInt(candidate.benefit.percent ?? 0)) / 100n);
    if (amountMinor > 0) lines.push({ skuId: line.skuId, quantity: line.quantity, amountMinor });
  }
  if (!lines.length)
    return { ...evaluated, eligible: false, application: null, reason: "INELIGIBLE" };
  const amountMinor = lines.reduce((total, line) => total + line.amountMinor, 0);
  return {
    ...evaluated,
    application: {
      ...evaluated.application,
      kind: "PRODUCT_SALE",
      lines,
      amountMinor,
      snapshot: {
        ...evaluated.application.snapshot,
        kind: "PRODUCT_SALE",
        lines,
        locationId: context.locationId,
        fulfillmentMode: context.fulfillmentMode,
        calculatedAmountMinor: amountMinor,
      },
    },
  };
}

/** Distinct item sales, one full-price grocery offer, and one delivery benefit. */
export function permitsPromotionStack(
  applications: readonly {
    component: "MERCHANDISE" | "DELIVERY";
    kind?: "PRODUCT_SALE";
    lines?: readonly { skuId: string }[];
  }[],
): boolean {
  const components = new Set<string>(),
    items = new Set<string>();
  for (const application of applications) {
    if (application.kind === "PRODUCT_SALE") {
      if (application.component !== "MERCHANDISE" || !application.lines?.length) return false;
      for (const line of application.lines) {
        if (items.has(line.skuId)) return false;
        items.add(line.skuId);
      }
    } else {
      if (components.has(application.component)) return false;
      components.add(application.component);
    }
  }
  return true;
}

export function evaluateCheckoutPromotionCandidates(
  context: PromotionEvaluationContext,
  facts: PromotionEligibilityFacts,
  candidates: readonly CheckoutPromotionCandidate[],
): { applications: CheckoutPromotionApplication[]; feedback: PromotionCodeFeedback[] } {
  const requested = context.requestedCodes.map((code) => code.trim().toUpperCase());
  const firstRequestedIndex = new Map<string, number>();
  requested.forEach((code, index) => {
    if (!firstRequestedIndex.has(code)) firstRequestedIndex.set(code, index);
  });
  const byCode = new Map(candidates.map((candidate) => [candidate.code.toUpperCase(), candidate]));
  const sales = candidates
    .filter((candidate) => candidate.productTargets?.length)
    .map((candidate) => evaluateProductSale(candidate, context, facts));
  // Activation prevents overlap. Retained/corrupt overlap must never silently
  // award two discounts on the same item or choose an invented precedence.
  const saleSkuCounts = new Map<string, number>();
  for (const sale of sales)
    for (const line of sale.application?.lines ?? [])
      saleSkuCounts.set(line.skuId, (saleSkuCounts.get(line.skuId) ?? 0) + 1);
  for (const sale of sales)
    if (sale.application?.lines?.some((line) => (saleSkuCounts.get(line.skuId) ?? 0) > 1)) {
      sale.application = null;
      sale.eligible = false;
      sale.reason = "INELIGIBLE";
    }
  const saleApplications = sales.flatMap((sale) => (sale.application ? [sale.application] : []));
  const discountedSkus = new Set(
    saleApplications.flatMap((sale) => sale.lines?.map((line) => line.skuId) ?? []),
  );
  const discountableSubtotalMinor =
    saleApplications.length > 0 && context.lineFacts
      ? context.lineFacts
          .filter((line) => !discountedSkus.has(line.skuId))
          .reduce((sum, line) => sum + line.lineSubtotalMinor, 0)
      : context.merchandiseSubtotalMinor;
  const evaluated = new Map(
    candidates.map((candidate) => [
      candidate.id,
      candidate.productTargets?.length
        ? (sales.find((sale) => sale.candidate.id === candidate.id) ??
          evaluateProductSale(candidate, context, facts))
        : evaluate(candidate, { ...context, discountableSubtotalMinor }, facts),
    ]),
  );

  const winners: CheckoutPromotionApplication[] = [...saleApplications];
  for (const component of ["MERCHANDISE", "DELIVERY"] as const) {
    const explicit = [...firstRequestedIndex]
      .map(([code, index]) => ({ index, candidate: byCode.get(code) }))
      .filter(
        (entry): entry is { index: number; candidate: CheckoutPromotionCandidate } =>
          entry.candidate !== undefined,
      )
      .map((entry) => ({ index: entry.index, evaluated: evaluated.get(entry.candidate.id)! }))
      .filter(
        (entry) =>
          entry.evaluated.eligible &&
          entry.evaluated.application?.component === component &&
          !entry.evaluated.application.kind,
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
      .filter(
        (entry) =>
          entry.eligible && entry.application?.component === component && !entry.application.kind,
      )
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
