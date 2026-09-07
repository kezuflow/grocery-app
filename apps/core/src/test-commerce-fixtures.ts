/** Minimal parent records for tests that exercise operational children. */
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
