export function requireCustomerWrite(database: D1Database): D1PreparedStatement {
  return database.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()!=1");
}

/** Core command-owned authority and claim; never an outside-transaction lease. */
export function beginCustomerAdministrationWrite(
  database: D1Database,
  input: {
    staffId: string;
    authUserId: string;
    scope: string;
    key: string;
    hash: string;
    resultType: string;
    now: number;
  },
): D1PreparedStatement[] {
  return [
    database
      .prepare(`INSERT INTO commitment_abort(id) SELECT -36 WHERE NOT EXISTS (
      SELECT 1 FROM staff_identity s JOIN staff_scope sc ON sc.staff_id=s.id AND sc.scope_kind='global'
      JOIN staff_role sr ON sr.staff_id=s.id JOIN role_permission rp ON rp.role_id=sr.role_id
      JOIN permission p ON p.id=rp.permission_id
      WHERE s.id=? AND s.auth_user_id=? AND s.status='active' AND p.code='customers.manage')`)
      .bind(input.staffId, input.authUserId),
    database
      .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at)
      VALUES (?,?,?,'PROCESSING',?,?,?) ON CONFLICT(scope,idempotency_key) DO UPDATE SET status='PROCESSING',result_type=excluded.result_type,updated_at=excluded.updated_at
      WHERE idempotency_records.request_hash=excluded.request_hash AND idempotency_records.status IN ('PROCESSING','FAILED')`)
      .bind(input.scope, input.key, input.hash, input.resultType, input.now, input.now),
    requireCustomerWrite(database),
  ];
}

export function completeCustomerAdministrationWrite(
  database: D1Database,
  input: { scope: string; key: string; hash: string; result: unknown; now: number },
): D1PreparedStatement[] {
  return [
    database
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
      )
      .bind(JSON.stringify(input.result), input.now, input.scope, input.key, input.hash),
    requireCustomerWrite(database),
  ];
}
