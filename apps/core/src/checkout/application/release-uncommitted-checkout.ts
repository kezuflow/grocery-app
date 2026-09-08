/** Checkout-owned entitlement release; the composing command supplies financial authority. */
export function releaseUncommittedCheckoutStatements(
  database: D1Database,
  input: {
    quoteId: string;
    paymentIntentId: string | null;
    customerId: string;
    now: number;
    attemptStatus?: "FAILED" | "EXPIRED";
  },
): D1PreparedStatement[] {
  const { quoteId, paymentIntentId, customerId, now } = input;
  // Another paid/startable attempt or a committed winning Order still owns shared entitlements.
  const eligible = `NOT EXISTS (SELECT 1 FROM order_payment_reaction WHERE checkout_quote_id=?) AND NOT EXISTS (SELECT 1 FROM payment_intent WHERE subject_type='checkout_quote' AND subject_id=? AND id IS NOT ? AND status IN ('INITIATED','REQUIRES_ACTION','PROCESSING','SUCCEEDED','PARTIALLY_REFUNDED'))`;
  const binds = [quoteId, quoteId, paymentIntentId];
  return [
    database
      .prepare(
        `INSERT INTO commitment_abort(id) SELECT -42 WHERE ${eligible} AND EXISTS (SELECT 1 FROM capacity_allocations a WHERE a.checkout_attempt_id=? AND a.status='HELD' AND NOT EXISTS (SELECT 1 FROM cycle_zone_capacity b WHERE b.cycle_id=a.cycle_id AND b.zone_id=a.zone_id AND b.location_id=a.location_id))`,
      )
      .bind(...binds, quoteId),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -42 WHERE EXISTS (SELECT 1 FROM checkout_quote WHERE id=? AND customer_id IS NOT ?) OR EXISTS (SELECT 1 FROM checkout_attempts WHERE id=? AND customer_id IS NOT ?)",
      )
      .bind(quoteId, customerId, quoteId, customerId),
    database
      .prepare(
        `INSERT INTO commitment_abort(id) SELECT -42 WHERE ${eligible} AND EXISTS (SELECT 1 FROM cycle_zone_capacity balance WHERE allocated<(SELECT COALESCE(SUM(units),0) FROM capacity_allocations a WHERE a.checkout_attempt_id=? AND a.status='HELD' AND a.cycle_id=balance.cycle_id AND a.zone_id=balance.zone_id AND a.location_id=balance.location_id))`,
      )
      .bind(...binds, quoteId),
    database
      .prepare(
        `UPDATE cycle_zone_capacity SET allocated=allocated-(SELECT COALESCE(SUM(units),0) FROM capacity_allocations a WHERE a.checkout_attempt_id=? AND a.status='HELD' AND a.cycle_id=cycle_zone_capacity.cycle_id AND a.zone_id=cycle_zone_capacity.zone_id AND a.location_id=cycle_zone_capacity.location_id),version=version+1 WHERE ${eligible} AND EXISTS (SELECT 1 FROM capacity_allocations a WHERE a.checkout_attempt_id=? AND a.status='HELD' AND a.cycle_id=cycle_zone_capacity.cycle_id AND a.zone_id=cycle_zone_capacity.zone_id AND a.location_id=cycle_zone_capacity.location_id)`,
      )
      .bind(quoteId, ...binds, quoteId),
    database
      .prepare(
        `INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=(SELECT COUNT(*) FROM cycle_zone_capacity balance WHERE ${eligible} AND EXISTS (SELECT 1 FROM capacity_allocations a WHERE a.checkout_attempt_id=? AND a.status='HELD' AND a.cycle_id=balance.cycle_id AND a.zone_id=balance.zone_id AND a.location_id=balance.location_id))`,
      )
      .bind(...binds, quoteId),
    database
      .prepare(
        `UPDATE capacity_allocations SET status='RELEASED',updated_at=? WHERE checkout_attempt_id=? AND status='HELD' AND ${eligible}`,
      )
      .bind(now, quoteId, ...binds),
    database
      .prepare(
        `UPDATE checkout_inventory_holds SET status='RELEASED',updated_at=? WHERE checkout_attempt_id=? AND status='HELD' AND ${eligible}`,
      )
      .bind(now, quoteId, ...binds),
    database
      .prepare(
        `UPDATE checkout_attempts SET status=?,version=version+1,updated_at=? WHERE id=? AND status='PROCESSING' AND ${eligible}`,
      )
      .bind(input.attemptStatus ?? "FAILED", now, quoteId, ...binds),
    database
      .prepare(
        `UPDATE checkout_quote SET status='SUPERSEDED',version=version+1,updated_at=? WHERE id=? AND status='ACTIVE' AND ${eligible}`,
      )
      .bind(now, quoteId, ...binds),
    database
      .prepare(
        `INSERT INTO commitment_abort(id) SELECT -42 WHERE ${eligible} AND (EXISTS (SELECT 1 FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND status='HELD') OR EXISTS (SELECT 1 FROM capacity_allocations WHERE checkout_attempt_id=? AND status='HELD') OR EXISTS (SELECT 1 FROM checkout_attempts WHERE id=? AND status='PROCESSING') OR EXISTS (SELECT 1 FROM checkout_quote WHERE id=? AND status='ACTIVE'))`,
      )
      .bind(...binds, quoteId, quoteId, quoteId, quoteId),
  ];
}
