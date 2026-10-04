/** A historical Scheduled Order that had already started picking before workflow retirement. */
export async function seedRetainedScheduledPicking(
  database: D1Database,
  orderId: string,
): Promise<void> {
  const results = await database.batch([
    database
      .prepare(
        "UPDATE fulfillment_record SET status='PICKING',version=version+1 WHERE order_id=? AND status='NOT_STARTED'",
      )
      .bind(orderId),
    database
      .prepare(
        "UPDATE grocery_order SET status='FULFILLMENT_PENDING',version=version+1 WHERE id=? AND fulfillment_mode='SCHEDULED' AND status='COMMITTED'",
      )
      .bind(orderId),
  ]);
  // D1 metadata includes operational-revision trigger writes as well as each target update.
  if (results.some((result) => result.meta.changes < 1))
    throw new Error("Invalid retained Scheduled fixture");
}

export async function seedTestCycle(database: D1Database, id: string): Promise<void> {
  await database
    .prepare(`INSERT OR IGNORE INTO delivery_cycle
    (id,market_id,name,order_opens_at,delivery_date,cutoff_at,status,capacity,allocated,version)
    SELECT ?,market_id,name,order_opens_at,delivery_date,cutoff_at,status,capacity,allocated,version FROM delivery_cycle WHERE id='cycle-next-cebu'`)
    .bind(id)
    .run();
}

export async function seedTestInstantOrder(database: D1Database, id: string): Promise<void> {
  await database.batch([
    database
      .prepare(
        "INSERT OR IGNORE INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
      )
      .bind(`customer-${id}`, `auth-${id}`),
    database
      .prepare(
        "INSERT OR IGNORE INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,100,'PHP','SUCCEEDED','mock',?,1,1)",
      )
      .bind(`payment-${id}`, `customer-${id}`, `payment-${id}`),
    database
      .prepare(`INSERT OR IGNORE INTO grocery_order
      (id,customer_id,payment_id,fulfillment_mode,cycle_id,address_snapshot_json,status,total_minor,currency,created_at)
      VALUES (?,?,?,'INSTANT',NULL,'{}','PAID',100,'PHP',1)`)
      .bind(id, `customer-${id}`, `payment-${id}`),
  ]);
}
