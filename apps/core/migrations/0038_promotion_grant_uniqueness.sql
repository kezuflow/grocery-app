-- Promotion grants are customer-specific authority. Reconcile any historical
-- duplicate admin grants before enforcing one grant per promotion/customer.
-- System membership authorities have NULL customer_id and remain unaffected.

UPDATE promotion_redemption
SET grant_id = (
  SELECT survivor.id
  FROM promotion_grant AS survivor
  JOIN promotion_grant AS duplicate
    ON duplicate.benefit_code = survivor.benefit_code
   AND duplicate.customer_id = survivor.customer_id
  WHERE duplicate.id = promotion_redemption.grant_id
  ORDER BY survivor.created_at ASC, survivor.id ASC
  LIMIT 1
)
WHERE grant_id IN (
  SELECT duplicate.id
  FROM promotion_grant AS duplicate
  WHERE duplicate.customer_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM promotion_grant AS survivor
      WHERE survivor.benefit_code = duplicate.benefit_code
        AND survivor.customer_id = duplicate.customer_id
        AND (
          survivor.created_at < duplicate.created_at
          OR (survivor.created_at = duplicate.created_at AND survivor.id < duplicate.id)
        )
    )
);

DELETE FROM promotion_grant
WHERE customer_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM promotion_grant AS survivor
    WHERE survivor.benefit_code = promotion_grant.benefit_code
      AND survivor.customer_id = promotion_grant.customer_id
      AND (
        survivor.created_at < promotion_grant.created_at
        OR (survivor.created_at = promotion_grant.created_at AND survivor.id < promotion_grant.id)
      )
  );

CREATE UNIQUE INDEX promotion_grant_promotion_customer_unique
  ON promotion_grant(benefit_code, customer_id)
  WHERE customer_id IS NOT NULL;
