import { promotionRuleSchema } from "@freshmarkets/validation";
import {
  evaluateCheckoutPromotionCandidates,
  permitsPromotionStack,
  type CheckoutPromotionApplication,
  type CheckoutPromotionCandidate,
  type CheckoutPromotionRule,
  type PromotionEvaluationContext,
  type PromotionCodeFeedback,
} from "../domain/checkout-promotion";

type PromotionRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  benefit_type: CheckoutPromotionCandidate["benefit"]["type"];
  discount_minor: number | null;
  percent: number | null;
  maximum_discount_minor: number | null;
  minimum_minor: number;
  starts_at: number;
  ends_at: number | null;
  global_usage_limit: number | null;
  per_customer_usage_limit: number | null;
  automatic: number;
  priority: number;
  version: number;
  grant_id: string | null;
  grant_max_redemptions: number | null;
  grant_status: string | null;
  global_usage_count: number;
  customer_usage_count: number;
  grant_redemption_count: number;
};

function safeRule(row: {
  rule_type: string;
  parameters_json: string;
}): CheckoutPromotionRule | null {
  try {
    const parsed = promotionRuleSchema.safeParse({
      type: row.rule_type,
      parameters: JSON.parse(row.parameters_json),
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type CheckoutPromotionEvaluation = {
  applications: CheckoutPromotionApplication[];
  feedback: PromotionCodeFeedback[];
};

export async function evaluateCheckoutPromotions<T extends PromotionEvaluationContext>(
  database: D1Database,
  context: T,
): Promise<CheckoutPromotionEvaluation> {
  const requestedCodes = [
    ...new Set(context.requestedCodes.map((code) => code.trim().toUpperCase())),
  ];
  const requestedPlaceholders = requestedCodes.map(() => "?").join(",");
  const requestedClause =
    requestedCodes.length > 0 ? `UPPER(p.code) IN (${requestedPlaceholders}) OR` : "";
  const rows = await database
    .prepare(
      `SELECT p.id, p.code, p.name, p.status, p.benefit_type, p.discount_minor, p.percent,
              p.maximum_discount_minor, p.minimum_minor, p.starts_at, p.ends_at, p.global_usage_limit,
              p.per_customer_usage_limit, p.automatic, p.priority, p.version,
              g.id AS grant_id, g.max_redemptions AS grant_max_redemptions,
              g.status AS grant_status,
              (SELECT COUNT(*) FROM promotion_redemption pr WHERE pr.promotion_id=p.id) AS global_usage_count,
              (SELECT COUNT(*) FROM promotion_redemption pr WHERE pr.promotion_id=p.id AND pr.customer_id=?) AS customer_usage_count,
              (SELECT COUNT(*) FROM promotion_redemption pr WHERE pr.grant_id=g.id) AS grant_redemption_count
       FROM promotion p
       LEFT JOIN promotion_grant g ON g.benefit_code=p.code AND g.customer_id=? AND g.status='ACTIVE'
       WHERE ${requestedClause} p.automatic=1 OR g.id IS NOT NULL
       ORDER BY p.id`,
    )
    .bind(context.customerId, context.customerId, ...requestedCodes)
    .all<PromotionRow>();

  const promotionIds = rows.results.map((row) => row.id);
  const rulesByPromotion = new Map<string, CheckoutPromotionRule[]>();
  if (promotionIds.length > 0) {
    const rules = await database
      .prepare(
        `SELECT promotion_id, rule_type, parameters_json FROM promotion_rule
         WHERE promotion_id IN (${promotionIds.map(() => "?").join(",")})
         ORDER BY promotion_id, sort_order, id`,
      )
      .bind(...promotionIds)
      .all<{ promotion_id: string; rule_type: string; parameters_json: string }>();
    for (const row of rules.results) {
      const parsed = safeRule(row);
      const current = rulesByPromotion.get(row.promotion_id) ?? [];
      if (parsed) current.push(parsed);
      else current.push({ type: "SPECIFIC_CUSTOMERS", parameters: { customerIds: [] } });
      rulesByPromotion.set(row.promotion_id, current);
    }
  }

  const [orderCount, segments] = await Promise.all([
    database
      .prepare("SELECT COUNT(*) AS count FROM grocery_order WHERE customer_id=?")
      .bind(context.customerId)
      .first<{ count: number }>(),
    database
      .prepare(
        `SELECT csa.segment_id FROM customer_segment_assignment csa
         JOIN customer_segment cs ON cs.id=csa.segment_id AND cs.status='ACTIVE'
         WHERE csa.customer_id=?`,
      )
      .bind(context.customerId)
      .all<{ segment_id: string }>(),
  ]);

  const candidates: CheckoutPromotionCandidate[] = rows.results.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    globalUsageLimit: row.global_usage_limit,
    perCustomerUsageLimit: row.per_customer_usage_limit,
    globalUsageCount: row.global_usage_count,
    customerUsageCount: row.customer_usage_count,
    automatic: row.automatic === 1,
    priority: row.priority,
    version: row.version,
    grant:
      row.grant_id && row.grant_status === "ACTIVE" && row.grant_max_redemptions !== null
        ? {
            id: row.grant_id,
            maxRedemptions: row.grant_max_redemptions,
            redemptionCount: row.grant_redemption_count,
          }
        : null,
    benefit: {
      type: row.benefit_type,
      discountMinor: row.discount_minor,
      percent: row.percent,
      maximumDiscountMinor: row.maximum_discount_minor,
    },
    rules: [
      ...(row.minimum_minor > 0
        ? ([{ type: "MINIMUM_SUBTOTAL", parameters: { minimumMinor: row.minimum_minor } }] as const)
        : []),
      ...(rulesByPromotion.get(row.id) ?? []),
    ],
  }));
  return evaluateCheckoutPromotionCandidates(
    context,
    {
      firstOrder: (orderCount?.count ?? 0) === 0,
      newCustomer: (orderCount?.count ?? 0) === 0,
      segmentIds: segments.results.map((row) => row.segment_id),
    },
    candidates,
  );
}

export function promotionClaimStatements(
  database: D1Database,
  quoteId: string,
  customerId: string,
  applications: readonly CheckoutPromotionApplication[],
  now: number,
): D1PreparedStatement[] {
  if (!permitsPromotionStack(applications)) throw new Error("PROMOTION_STACK_NOT_PERMITTED");
  return applications.map((application) =>
    database
      .prepare(
        `INSERT INTO checkout_promotion_claim (
          id, checkout_quote_id, promotion_id, customer_id, price_component,
          benefit_type, amount_minor, definition_version, grant_id, snapshot_json,
          status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNCOMMITTED', ?)`,
      )
      .bind(
        crypto.randomUUID(),
        quoteId,
        application.promotionId,
        customerId,
        application.component,
        application.benefitType,
        application.amountMinor,
        application.definitionVersion,
        application.grantId,
        JSON.stringify(application.snapshot),
        now,
      ),
  );
}
