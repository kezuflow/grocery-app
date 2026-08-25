export type ExpiredCheckoutAttempt = {
  id: string;
  cycleId: string;
  zoneId: string;
  locationId: string;
  idempotencyKey: string;
};

/** Releases every reservation owned by an expired checkout attempt exactly once. */
export async function expireCheckoutAttempts(db: D1Database, now: number): Promise<number> {
  const attempts = await db
    .prepare(
      "SELECT id, cycle_id, zone_id, location_id, idempotency_key FROM checkout_attempts WHERE status='PROCESSING' AND expires_at IS NOT NULL AND expires_at<=?",
    )
    .bind(now)
    .all<{
      id: string;
      cycle_id: string;
      zone_id: string;
      location_id: string;
      idempotency_key: string;
    }>();

  for (const attempt of attempts.results) {
    const reference = `checkout_attempt:${attempt.id}`;
    await db.batch([
      db
        .prepare(
          "INSERT INTO inventory_ledger_entries (id, inventory_pool_id, location_id, movement_type, quantity_delta_base, reservation_delta_base, reference_type, reference_id, actor_type, reason_code, metadata_json, created_at) SELECT lower(hex(randomblob(16))), h.inventory_pool_id, h.location_id, 'CHECKOUT_RELEASE', 0, -SUM(h.quantity), 'checkout_attempt', ?, 'SYSTEM', 'CHECKOUT_EXPIRED', '{}', ? FROM checkout_inventory_holds h WHERE h.checkout_attempt_id=? AND h.status='HELD' GROUP BY h.inventory_pool_id, h.location_id",
        )
        .bind(reference, now, attempt.id),
      db
        .prepare(
          "UPDATE cycle_zone_capacity SET allocated=MAX(0, allocated-1), version=version+1 WHERE cycle_id=? AND zone_id=? AND location_id=? AND EXISTS (SELECT 1 FROM capacity_allocations WHERE checkout_attempt_id=? AND status='HELD')",
        )
        .bind(attempt.cycle_id, attempt.zone_id, attempt.location_id, attempt.id),
      db
        .prepare(
          "UPDATE inventory_balance SET reserved=MAX(0, reserved-(SELECT COALESCE(SUM(h.quantity),0) FROM checkout_inventory_holds h WHERE h.checkout_attempt_id=? AND h.inventory_pool_id=inventory_balance.inventory_pool_id AND h.location_id=inventory_balance.location_id AND h.status='HELD')), version=version+1 WHERE EXISTS (SELECT 1 FROM checkout_inventory_holds h WHERE h.checkout_attempt_id=? AND h.inventory_pool_id=inventory_balance.inventory_pool_id AND h.location_id=inventory_balance.location_id AND h.status='HELD')",
        )
        .bind(attempt.id, attempt.id),
      db
        .prepare(
          "UPDATE capacity_allocations SET status='EXPIRED', updated_at=? WHERE checkout_attempt_id=? AND status='HELD'",
        )
        .bind(now, attempt.id),
      db
        .prepare(
          "UPDATE checkout_inventory_holds SET status='EXPIRED', updated_at=? WHERE checkout_attempt_id=? AND status='HELD'",
        )
        .bind(now, attempt.id),
      db
        .prepare(
          "UPDATE checkout_attempts SET status='EXPIRED', version=version+1, updated_at=? WHERE id=? AND status='PROCESSING'",
        )
        .bind(now, attempt.id),
      db
        .prepare(
          "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope='checkout.quote' AND idempotency_key=? AND status='PROCESSING'",
        )
        .bind(now, attempt.idempotency_key),
    ]);
  }
  return attempts.results.length;
}
