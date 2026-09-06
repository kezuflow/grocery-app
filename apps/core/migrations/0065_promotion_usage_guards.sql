-- Checkout evaluates limits for user feedback; these database guards are the
-- final concurrency boundary when multiple paid commitments race.

CREATE TRIGGER promotion_redemption_global_limit_guard
BEFORE INSERT ON promotion_redemption
WHEN NEW.promotion_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM promotion p
  WHERE p.id=NEW.promotion_id
    AND p.global_usage_limit IS NOT NULL
    AND (SELECT COUNT(*) FROM promotion_redemption r WHERE r.promotion_id=p.id)
        >= p.global_usage_limit
)
BEGIN
  SELECT RAISE(ABORT, 'PROMOTION_GLOBAL_USAGE_LIMIT_REACHED');
END;

CREATE TRIGGER promotion_redemption_customer_limit_guard
BEFORE INSERT ON promotion_redemption
WHEN NEW.promotion_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM promotion p
  WHERE p.id=NEW.promotion_id
    AND p.per_customer_usage_limit IS NOT NULL
    AND (
      SELECT COUNT(*) FROM promotion_redemption r
      WHERE r.promotion_id=p.id AND r.customer_id=NEW.customer_id
    ) >= p.per_customer_usage_limit
)
BEGIN
  SELECT RAISE(ABORT, 'PROMOTION_CUSTOMER_USAGE_LIMIT_REACHED');
END;

CREATE TRIGGER promotion_redemption_grant_limit_guard
BEFORE INSERT ON promotion_redemption
WHEN EXISTS (
  SELECT 1 FROM promotion_grant g
  WHERE g.id=NEW.grant_id
    AND (SELECT COUNT(*) FROM promotion_redemption r WHERE r.grant_id=g.id)
        >= g.max_redemptions
)
BEGIN
  SELECT RAISE(ABORT, 'PROMOTION_GRANT_USAGE_LIMIT_REACHED');
END;
